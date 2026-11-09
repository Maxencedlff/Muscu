// ═══════════════════════════════════════════════════════════
//  Code-barres d'un produit alimentaire → Open Food Facts → aliment perso (logique pure, sauf le fetch)
//
//  - Lecture : module natif MdlfScanner (ios/App/App/ScannerPlugin.swift) ou saisie des chiffres à la main
//    (navigateur, Android, coquille sans le module) ; écran dans js/features/food-scan-ui.js.
//  - normBarcode : EAN-13, EAN-8, UPC-A (12 chiffres, ramené à 13 avec un 0 comme le fait Open Food Facts) et
//    UPC-E (déplié en UPC-A), chiffre de contrôle vérifié : une faute de frappe ne part jamais sur le réseau.
//  - offLookup : API v2 d'Open Food Facts (base libre, licence ODbL : attribution dans dietSourceFoot et la
//    feuille du produit). Seul le numéro du code-barres part, sans identifiant, sans cookie, avec un
//    User-Agent générique de l'app (pas d'adresse e-mail) ; délai court ; hors ligne dit tel quel.
//  - offParse : valeurs pour 100 g (ou 100 ml) ; énergie absente → depuis les kJ, sinon 4/4/9 (ecalc) ;
//    valeurs hors des bornes de cleanDietPer → « incomplet » (la personne saisit l'étiquette).
//  - Mes aliments (data.dietFoods) : un produit trouvé y est gardé avec son code ; au scan suivant, il est
//    retrouvé sur l'appareil, sans réseau (dietFoodByCode).
// ═══════════════════════════════════════════════════════════
'use strict';

const OFF_FIELDS  = 'product_name,product_name_fr,brands,nutriments,quantity';
const OFF_TIMEOUT = 6000;   // ms : au-delà, le réseau est jugé absent (salle de sport, sous-sol)
const OFF_SALT_MAX = 100;   // g de sel pour 100 g (sel fin : 99)
const BARCODE_RE  = /^\d{8}$|^\d{13}$/;   // forme gardée : EAN-8 ou EAN-13
const offProductUrl = code => `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`;

// Chiffre de contrôle GS1 (EAN-8, UPC-A, EAN-13, GTIN-14) : poids 3 et 1 depuis la droite
function gtinCheckOk(s) {
  if (!/^\d{8,14}$/.test(s)) return false;
  let sum = 0;
  for (let i = s.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(s[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(s[s.length - 1]);
}
function gtinCheckDigit(body) {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += Number(body[i]) * w;
  return String((10 - (sum % 10)) % 10);
}
// UPC-E (6, 7 ou 8 chiffres : système, 6 chiffres, contrôle) → UPC-A (12 chiffres), null s'il est invalide
function upceToUpca(raw) {
  let s = String(raw ?? '');
  if (!/^\d{6,8}$/.test(s)) return null;
  if (s.length === 6) s = '0' + s;
  const sys = s[0], d = s.slice(1, 7);
  if (sys !== '0' && sys !== '1') return null;
  const last = d[5];
  const body = last <= '2' ? `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`
    : last === '3' ? `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`
    : last === '4' ? `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`
    : `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`;
  const upca = sys + body + gtinCheckDigit(sys + body);
  return s.length === 8 && upca[11] !== s[7] ? null : upca;
}
// Code lu ou tapé → EAN-13 ou EAN-8 (chaîne), null s'il est illisible. type : 'upce' quand le lecteur le dit
function normBarcode(raw, type = '') {
  const s = String(raw ?? '').replace(/[\s.-]/g, '');
  if (!/^\d{6,14}$/.test(s)) return null;
  if (type === 'upce' || s.length === 6 || s.length === 7) { const a = upceToUpca(s); return a ? '0' + a : null; }
  let c = s;
  if (c.length === 14 && c[0] === '0') c = c.slice(1);   // GTIN-14 d'une unité de vente
  if (c.length === 12) c = '0' + c;                      // UPC-A : Open Food Facts le range en EAN-13
  return BARCODE_RE.test(c) && gtinCheckOk(c) ? c : null;
}
// « 3 017620 422003 » pour l'écran ; VoiceOver lit les chiffres un à un (barcodeSpoken)
const barcodeShown = c => (c.length === 13 ? `${c[0]} ${c.slice(1, 7)} ${c.slice(7)}` : c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c);
const barcodeSpoken = c => c.split('').join(' ');

// ── Réponse d'Open Food Facts ───────────────────────────────

// Nombre d'un champ des nutriments (chiffre ou texte « 6,3 »), null s'il manque ou n'est pas lisible
function offNum(n, key) {
  const v = n?.[key];
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(x) && x >= 0 ? x : null;
}
// « Marque · Nom » (nom français d'abord ; marque seule ou première des marques ; jamais deux fois la marque)
function offName(pr) {
  const t = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const nm = t(pr?.product_name_fr) || t(pr?.product_name);
  const brand = t(t(pr?.brands).split(',')[0]);
  const both = brand && nm && !normName(nm).includes(normName(brand)) ? `${brand} · ${nm}` : nm || brand;
  return dietCutName(both);
}
// Énergie pour 100 g : kcal déclarées, sinon kJ ÷ 4,184. Des kcal hors bornes (souvent des kJ mis dans le
// champ des kcal) laissent la place aux kJ
function offKcal(n) {
  const k = offNum(n, 'energy-kcal_100g');
  if (k !== null && k <= 900) return k;
  const kj = offNum(n, 'energy-kj_100g') ?? offNum(n, 'energy_100g');   // energy_100g : toujours en kJ
  return kj !== null ? kj / 4.184 : k;
}
// { status: 'found', food } | { status: 'incomplete', name } (produit connu, valeurs inutilisables) |
// { status: 'unknown' }. food : { name, code, fam, per, src: 'off', ecalc?, salt? }
function offParse(json, code) {
  const pr = json && typeof json === 'object' && json.status === 1 ? json.product : null;
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) return { status: 'unknown' };
  const name = offName(pr);
  const n = pr.nutriments && typeof pr.nutriments === 'object' ? pr.nutriments : {};
  const macros = ['proteins_100g', 'carbohydrates_100g', 'fat_100g'].map(key => offNum(n, key));
  // Deux macros au moins : la troisième absente vaut 0 (une eau ou une huile n'en donnent pas toujours trois)
  if (macros.filter(v => v !== null).length < 2) return { status: 'incomplete', name };
  const [p, c, f] = macros.map(v => v ?? 0);
  let k = offKcal(n), ecalc = false;
  if (k === null) { k = 4 * p + 4 * c + 9 * f; ecalc = true; }
  const per = cleanDietPer({ k, p, c, f });
  if (!per) return { status: 'incomplete', name };
  // Sel, pour la fiche : déclaré, sinon depuis le sodium (× 2,5) ; absent s'il est illisible
  const s0 = offNum(n, 'salt_100g') ?? (offNum(n, 'sodium_100g') !== null ? offNum(n, 'sodium_100g') * 2.5 : null);
  const salt = s0 !== null && s0 <= OFF_SALT_MAX ? Math.round(s0 * 100) / 100 : null;
  return { status: 'found', food: { name: name || `Produit ${code}`, code, fam: dietFamOf(per), per, src: 'off',
    ...(ecalc ? { ecalc: true } : {}), ...(salt !== null ? { salt } : {}) } };
}

// User-Agent demandé par Open Food Facts : nom et version de l'app, sans contact ni identifiant
function offUserAgent(version, platform = 'ios') {
  const v = typeof version === 'string' && /^[0-9][0-9.]{0,15}$/.test(version) ? version : '1.0';
  return `MDLF Training/${v} (${platform === 'android' ? 'Android' : platform === 'web' ? 'Web' : 'iOS'})`;
}
// Recherche d'un code sur Open Food Facts : offParse(…) ou { status: 'offline' } (pas de réseau, délai
// dépassé) | { status: 'error' } (serveur en panne, réponse illisible). Jamais d'exception
async function offLookup(code, { fetchImpl = fetch, timeout = OFF_TIMEOUT, userAgent = offUserAgent(null) } = {}) {
  if (!BARCODE_RE.test(code || '')) return { status: 'unknown' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    // X-User-Agent : un navigateur peut ignorer User-Agent ; Open Food Facts accepte les deux (CORS)
    const r = await fetchImpl(offProductUrl(code), { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', 'User-Agent': userAgent, 'X-User-Agent': userAgent } });
    if (r.status === 404) return { status: 'unknown' };   // produit absent : 404 avec status 0
    if (!r.ok) return { status: 'error' };
    return offParse(await r.json(), code);
  } catch (e) {
    return { status: e?.name === 'SyntaxError' ? 'error' : 'offline' };
  } finally { clearTimeout(timer); }
}

// ── Mes aliments ────────────────────────────────────────────

// Aliment perso déjà gardé pour ce code (scanné, ou créé à la main après un code introuvable)
function dietFoodByCode(list, code) {
  return (Array.isArray(list) ? list : []).find(x => x?.code && x.code === code) || null;
}
// Garde le produit dans data.dietFoods (en tête) et le renvoie. Même code : remplacé. Même nom qu'un autre
// aliment perso : le code est ajouté au nom, l'aliment saisi à la main n'est jamais écrasé
function dietSaveScanned(d, food) {
  const list = (Array.isArray(d.dietFoods) ? d.dietFoods : []).filter(x => x?.code !== food.code);
  let name = food.name;
  if (list.some(x => normName(x.name) === normName(name))) name = dietCutName(`${name.slice(0, DIET_FOOD_NAME_MAX - 16)} · ${food.code}`);
  const entry = { id: uid(), name, code: food.code, fam: food.fam, per: food.per, src: food.src === 'off' ? 'off' : 'perso',
    ...(food.ecalc ? { ecalc: true } : {}), ...(food.salt != null ? { salt: food.salt } : {}) };
  d.dietFoods = cleanDietFoods([entry, ...list]);
  return d.dietFoods.find(x => x.code === food.code) || null;
}
// Aliment perso gardé → aliment au format de la recherche (foodToItem)
const dietOwnPick = x => ({ code: null, name: x.name, fam: x.fam, per: x.per, ownId: x.id, src: x.src || 'perso',
  ...(x.code ? { barcode: x.code } : {}), ...(x.ecalc ? { ecalc: true } : {}), ...(x.salt != null ? { salt: x.salt } : {}) });
