// ═══════════════════════════════════════════════════════════
//  Scanner un aliment : code-barres → fiche du produit (Open Food Facts) → grammes → kcal et macros
//
//  - Entrée : « Scanner un code-barres » en tête de la feuille « Ajouter un aliment » (dietPickFood) ;
//    foodScanFlow() rend { food, g } et sert partout où l'on choisit un aliment (dietChooseFood).
//  - Lecture : module natif MdlfScanner (Native.scanner) ; sans lui (navigateur, Android, ancienne build),
//    le même bouton devient « Saisir un code-barres » : on tape les chiffres sous les barres.
//  - Fiche : produit déjà gardé dans Mes aliments → affiché tout de suite, sans réseau ; sinon recherche
//    sur Open Food Facts (js/data/food-scan.js), puis le produit est gardé dans Mes aliments. Introuvable,
//    valeurs incomplètes ou pas de réseau : « Créer l'aliment » (dietNewFood), code gardé pour le prochain scan.
//  - Tests : tests/test_scan_aliment.py simule le module natif (window.Capacitor) et la réponse d'Open Food
//    Facts (route Playwright) ; aucun appel réseau réel.
// ═══════════════════════════════════════════════════════════
'use strict';

let foodScanUa = null;   // User-Agent envoyé à Open Food Facts (version de l'app lue une fois)
async function foodScanUserAgent() {
  foodScanUa ||= offUserAgent(await Native.appVersion(), Native.platform);
  return foodScanUa;
}

// Bouton en tête de la feuille « Ajouter un aliment » : même icône et même sens, scanné ou tapé
function foodScanButtonHtml() {
  return `<button class="diet-cand diet-cand--scan" data-pick="scan">${icon('barcode', 22)}<span class="diet-cand__name">${Native.scanner.available ? 'Scanner un code-barres' : 'Saisir un code-barres'}</span></button>`;
}

// Chiffres tapés à la main : code normalisé (EAN-13 ou EAN-8) ou null (annulé)
async function foodScanTypeCode(message = 'Tape les chiffres écrits sous les barres du paquet.') {
  let value = '';
  for (;;) {
    const raw = await dialog({ title: 'Code-barres', message, input: { value, placeholder: '3017620422003', digits: true }, actions: [
      { label: 'Annuler', style: 'cancel' },
      { label: 'Rechercher', style: 'preferred' },
    ] });
    if (raw === null || !String(raw).trim()) return null;
    const code = normBarcode(raw);
    if (code) return code;
    value = String(raw).trim();
    message = 'Ce code ne tient pas : vérifie les chiffres (13 le plus souvent, parfois 8 ou 12).';
  }
}

// Code lu par la caméra (ou tapé si la caméra manque ou est refusée) ; null : rien à chercher
async function foodScanReadCode() {
  if (!Native.scanner.available) return foodScanTypeCode();
  const r = await Native.scanner.scan();
  if (r.canceled) return null;
  if (r.code) {
    const code = normBarcode(r.code, r.type);
    if (code) return code;
    return foodScanTypeCode('Ce code-barres n\'a pas pu être lu. Tape ses chiffres.');
  }
  if (r.denied) {
    const v = await dialog({ title: 'Appareil photo refusé', message: 'Pour scanner, autorise l\'appareil photo dans Réglages › MDLF Training. Tu peux aussi taper les chiffres du code-barres.', actions: [
      { label: 'Annuler', style: 'cancel' },
      { label: 'Taper le code', value: 'type', style: 'preferred' },
    ] });
    return v === 'type' ? foodScanTypeCode() : null;
  }
  return foodScanTypeCode('La caméra n\'est pas disponible. Tape les chiffres du code-barres.');
}

// ── Fiche du produit ────────────────────────────────────────

const FSCAN_STATES = {
  unknown: { title: 'Produit introuvable', text: 'Ce code-barres n\'est pas dans Open Food Facts. Crée l\'aliment avec les valeurs de l\'étiquette : il sera retrouvé à ton prochain scan.' },
  incomplete: { title: 'Valeurs incomplètes', text: 'Open Food Facts connaît ce produit, mais pas toutes ses valeurs pour 100 g. Recopie-les depuis l\'étiquette : l\'aliment sera retrouvé à ton prochain scan.' },
  offline: { title: 'Pas de réseau', text: 'La recherche du produit demande une connexion. Réessaie, ou crée l\'aliment avec les valeurs de l\'étiquette.', retry: true },
  error: { title: 'Open Food Facts ne répond pas', text: 'Réessaie dans un moment, ou crée l\'aliment avec les valeurs de l\'étiquette.', retry: true },
};
const fscanCodeHtml = code => `<p class="fscan__code num">Code-barres ${dietSrPair(barcodeShown(code), barcodeSpoken(code))}</p>`;
const fscanSrcHtml = () => '<p class="fscan__src">Source : Open Food Facts (openfoodfacts.org), © les contributeurs d\'Open Food Facts, base libre sous licence ODbL. Vérifie avec l\'étiquette du paquet.</p>';

function fscanLoadingHtml(code) {
  return `<div class="fscan__state" role="status"><span class="fscan__spin" aria-hidden="true"></span>
      <p class="fscan__title">Recherche du produit…</p>${fscanCodeHtml(code)}</div>`;
}
function fscanStateHtml(kind, code) {
  const s = FSCAN_STATES[kind];
  return `<div class="fscan__state">
      <span class="fscan__icon" aria-hidden="true">${icon('barcode', 34)}</span>
      <h3 class="fscan__title" tabindex="-1">${esc(s.title)}</h3>
      ${fscanCodeHtml(code)}
      <p class="fscan__text">${esc(s.text)}</p>
      ${s.retry ? '<button class="btn btn--primary btn--full" data-fscan="retry">Réessayer</button>' : ''}
      <button class="btn ${s.retry ? 'btn--secondary' : 'btn--primary'} btn--full" data-fscan="create">Créer l'aliment</button>
      ${kind === 'unknown' || kind === 'incomplete' ? fscanSrcHtml() : ''}
    </div>`;
}
// Valeurs pour 100 g, la quantité (100 g d'office, ou 1 unité du paquet : « 1 pot ») et ce qu'elle apporte,
// recalculé à la frappe. units : dietQtyUnits(food)
function fscanFoundHtml(food, units = [], { kept = true } = {}) {
  const per = food.per;
  const row = (label, shown, spoken) => `<div class="fscan__row" role="listitem"><span class="fscan__k">${label}</span><span class="fscan__v num">${dietSrPair(shown, spoken)}</span></div>`;
  const g1 = v => fmtNum(v, 1);
  return `<div class="fscan__prod">
      <h3 class="fscan__name" tabindex="-1">${esc(foodName(food.name))}</h3>
      ${fscanCodeHtml(food.code)}
    </div>
    <div class="fscan__vals-title" aria-hidden="true">Pour 100 g</div>
    <div class="fscan__vals" role="list" aria-label="Pour 100 grammes">
      ${row('Énergie', `${per.k} kcal${food.ecalc ? ' (calculée)' : ''}`, `${per.k} kilocalories${food.ecalc ? ' calculées' : ''}`)}
      ${row('Protéines', `${g1(per.p)} g`, `${g1(per.p)} grammes`)}
      ${row('Glucides', `${g1(per.c)} g`, `${g1(per.c)} grammes`)}
      ${row('Lipides', `${g1(per.f)} g`, `${g1(per.f)} grammes`)}
      ${food.salt != null ? row('Sel', `${fmtNum(food.salt, 2)} g`, `${fmtNum(food.salt, 2)} grammes`) : ''}
    </div>
    ${units.length ? `<div class="fscan__qty">${dietQtyHtml(units, dietQtyInit(units, null))}</div>` : `
    <label class="diet-field fscan__qty"><span class="diet-field__label">Quantité</span>
      <input id="fscanG" class="diet-field__input num" type="text" inputmode="decimal" autocomplete="off" value="100" aria-label="Quantité en grammes, ${DIET_G_MAX} au plus">
      <span class="diet-field__unit">g</span></label>`}
    <p class="fscan__total num" id="fscanTotal" aria-live="polite"></p>
    ${units.length ? '' : dietMacroLegendHtml()}
    <p class="diet-form__err" id="fscanErr" role="alert"></p>
    ${food.src === 'off' ? fscanSrcHtml() : '<p class="fscan__src">Ton aliment, avec les valeurs que tu as saisies.</p>'}
    ${kept ? '<p class="fscan__src">Gardé dans Mes aliments : retrouvé sans réseau au prochain scan.</p>'
      : `<div class="fscan__full" role="note"><p>Mes aliments est plein (${DIET_FOODS_MAX}) : ce produit s'ajoute, mais n'y est pas gardé. Retire ceux dont tu ne te sers plus pour garder les prochains.</p>
      <button class="btn btn--secondary btn--full" data-fscan="foods">Gérer Mes aliments</button></div>`}`;
}
function fscanTotalText(food, g) {
  if (g === null) return '';
  const m = dietItemMacros({ g, per: food.per });
  return dietSrPair(`${fmtNum(g)} g : ${dietN(m.kcal)} kcal · P ${dietN(m.p)} · G ${dietN(m.c)} · L ${dietN(m.f)}`,
    `${fmtNum(g)} grammes : ${dietN(m.kcal)} kilocalories, ${dietMacroGramsSpoken(m)}`);
}

// Fiche d'un code : { food, g, por } (Ajouter), { create: nom } (Créer l'aliment) ou null (Annuler)
function foodScanSheet(code) {
  let food = null, busy = false, readQty = null;
  const body = `<div class="fscan" id="fscanBody">${fscanLoadingHtml(code)}</div>`;
  const p = sheet({ title: 'Produit', confirm: 'Ajouter', body, onConfirm: panel => {
    if (!food) return false;
    if (readQty) { const q = readQty(); return q ? { food: dietOwnPick(food), g: q.g, por: q.por } : false; }
    const g = num($('#fscanG', panel).value, 1, DIET_G_MAX);
    if (g === null) { $('#fscanErr', panel).textContent = `Quantité : de 1 à ${fmtNum(DIET_G_MAX)} g.`; return false; }
    return { food: dietOwnPick(food), g: Math.round(g), por: null };
  } });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  const box = $('#fscanBody', root), ok = $('.sheet__btn--confirm', root);
  ok.style.visibility = 'hidden';
  const show = (html, focusSel) => {
    box.innerHTML = html;
    const t = focusSel && $(focusSel, box);
    if (t) t.focus({ preventScroll: true });
  };
  const showFood = (f, { kept = true } = {}) => {
    food = f;
    const units = dietQtyUnits(f);
    show(fscanFoundHtml(f, units, { kept }), '.fscan__name');
    ok.style.visibility = '';
    // À l'unité : le contrôle donne résumé et macros, le total resterait une redite
    if (units.length) { readQty = dietQtyBind(box, units, dietQtyInit(units, null), f.per); return; }
    readQty = null;
    const upd = () => { $('#fscanTotal', box).innerHTML = fscanTotalText(f, num($('#fscanG', box).value, 1, DIET_G_MAX)); };
    $('#fscanG', box).addEventListener('input', upd);
    upd();
  };
  const lookup = async () => {
    if (busy) return;
    busy = true;
    show(fscanLoadingHtml(code));
    const r = await offLookup(code, { userAgent: await foodScanUserAgent() });
    busy = false;
    if (!root.isConnected) return;   // feuille fermée pendant la recherche
    if (r.status === 'found') {
      // Mes aliments plein : le produit s'ajoute quand même, sans y être gardé (fscanFoundHtml le dit)
      const full = dietScanFull(data, r.food);
      const kept = full ? null : dietSaveScanned(data, r.food);
      if (kept) save();
      const f = kept || (full ? r.food : null);
      if (f) { showFood(f, { kept: !!kept }); announce(`${f.name} trouvé${full ? '. Mes aliments est plein : il n\'y est pas gardé' : ''}`); return; }
    }
    const kind = FSCAN_STATES[r.status] ? r.status : 'error';
    show(fscanStateHtml(kind, code), '.fscan__title');
    box.dataset.name = r.status === 'incomplete' ? r.name || '' : '';
  };
  root.addEventListener('click', ev => {
    const b = ev.target.closest('[data-fscan]');
    if (!b) return;
    if (b.dataset.fscan === 'retry') lookup();
    else if (b.dataset.fscan === 'foods') root._close({ manage: true });
    else root._close({ create: box.dataset.name || '' });
  });
  // Déjà scanné (ou créé après un code introuvable) : sur l'appareil, sans réseau
  const local = dietFoodByCode(data.dietFoods, code);
  if (local) showFood(local); else lookup();
  return p;
}

// Code-barres → { food, g, por } prêt pour foodToItem, ou null. Introuvable : création de l'aliment, code gardé
async function foodScanFlow() {
  const code = await foodScanReadCode();
  if (!code) return null;
  const r = await foodScanSheet(code);
  if (!r) return null;
  if (r.manage) { dietOpenFoods(); return null; }
  if (r.create !== undefined) {
    const made = await dietNewFood(r.create, { code });
    if (!made?.food) return null;
    const q = await dietAskQty(made.food);
    return q && { food: made.food, g: q.g, por: q.por };
  }
  return r;
}
