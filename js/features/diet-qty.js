// ═══════════════════════════════════════════════════════════
//  Choix de la quantité d'un aliment : en grammes, ou à l'unité quand l'aliment en a une (« 2 œufs · 100 g »).
//  Portions : js/data/food-portions.js. La quantité est rendue en grammes (g) avec l'unité choisie (por) à côté.
//
//  - Contrôle segmenté « Grammes | œuf » (deux unités au plus : « c. à soupe | c. à café »), boutons − et + (pas
//    de 1, ½ pour la baguette, 10 g en grammes) et champ que l'on peut aussi taper. Rien au pointerdown.
//  - Ligne d'équivalence sous le champ : « 2 œufs · 100 g · 140 kcal », lue « 2 œufs, 100 grammes, 140 kilocalories ».
//  - Sert à la feuille de quantité (dietAskQty : plan, ajout du jour) et à la fiche d'un produit scanné.
// ═══════════════════════════════════════════════════════════
'use strict';

const QTY_G_STEP = 10;   // pas des boutons − et + en grammes

// Unités proposées pour cet aliment : celles de la table ou du paquet, plus l'unité déjà choisie (aliment du plan)
function dietQtyUnits(food, por = null) {
  const units = foodPortions(food);
  if (por && !units.some(u => u.u === por.u)) units.unshift({ u: por.u, pl: por.pl, g: por.g });
  return units.slice(0, 2);
}
const dietQtyLabel = u => { const s = u.s || u.u; return s.charAt(0).toUpperCase() + s.slice(1); };

// État de départ : unité déjà choisie, sinon grammes si une quantité est donnée, sinon 1 unité
function dietQtyInit(units, init) {
  if (init?.por) {
    const i = units.findIndex(u => u.u === init.por.u);
    if (i >= 0) return { mode: i, v: init.por.n };
  }
  if (init?.g != null || !units.length) return { mode: -1, v: init?.g ?? 100 };
  return { mode: 0, v: 1 };
}

// HTML du contrôle. units : dietQtyUnits ; st : dietQtyInit
function dietQtyHtml(units, st) {
  const seg = units.length ? `
      <div class="segmented seg-full qty__mode" role="group" aria-label="Quantité en">
        <button type="button" class="segmented__btn" data-qmode="-1">Grammes</button>
        ${units.map((u, i) => `<button type="button" class="segmented__btn" data-qmode="${i}" aria-label="À l'unité : ${esc(u.u)}">${esc(dietQtyLabel(u))}</button>`).join('')}
      </div>` : '';
  return `<div class="qty" data-qty>
      ${seg}
      <div class="qty__row">
        <button type="button" class="qty__step" data-qstep="-1">${icon('minus', 20)}</button>
        <label class="diet-field qty__field">
          <input id="qtyVal" class="diet-field__input num" type="text" inputmode="decimal" autocomplete="off" value="${esc(String(st.v))}">
          <span class="diet-field__unit" id="qtyUnit" aria-hidden="true"></span></label>
        <button type="button" class="qty__step" data-qstep="1">${icon('plus', 20)}</button>
      </div>
      <p class="qty__eq num" id="qtyEq" aria-live="polite"></p>
      <p class="qty__hint" id="qtyHint"></p>
      <p class="diet-form__err" id="qtyErr" role="alert"></p>
    </div>`;
}

// Lecture du champ : { g, por } ou { err } (message)
function dietQtyValue(units, mode, raw) {
  if (mode < 0) {
    const g = num(raw, 1, DIET_G_MAX);
    return g === null ? { err: `Quantité : de 1 à ${fmtNum(DIET_G_MAX)} g.` } : { g: Math.round(g), por: null };
  }
  const u = units[mode], n0 = num(raw, 0.5, PORTION_N_MAX);
  if (n0 === null) return { err: `De ${u.half ? '½' : '1'} à ${PORTION_N_MAX} ${u.pl}.` };
  const n = portionClampN(n0, u), g = portionGrams(n, u);
  if (g > DIET_G_MAX) return { err: `${fmtNum(DIET_G_MAX)} g au plus.` };
  return { g, por: { n, u: u.u, pl: u.pl, g: u.g } };
}

// Branche le contrôle placé dans root. per : valeurs pour 100 g. onChange(valeur) à chaque changement.
// Renvoie read() : { g, por } ou null (message affiché sous le champ)
function dietQtyBind(root, units, st, per, onChange = null) {
  const box = $('[data-qty]', root), input = $('#qtyVal', box);
  let mode = st.mode;
  const fmtV = v => (Number.isInteger(v) ? String(v) : fmtNum(v, 1));
  const paint = () => {
    const u = units[mode];
    for (const b of box.querySelectorAll('[data-qmode]')) {
      const on = Number(b.dataset.qmode) === mode;
      b.classList.toggle('segmented__btn--active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const r = dietQtyValue(units, mode, input.value);
    const nShown = mode >= 0 && !r.err ? r.por.n : null;
    $('#qtyUnit', box).textContent = mode < 0 ? 'g' : portionUnitWord(nShown ?? 1, u);
    input.setAttribute('aria-label', mode < 0 ? `Quantité en grammes, ${DIET_G_MAX} au plus` : `Nombre de ${u.pl}`);
    const stepLabel = mode < 0 ? `${QTY_G_STEP} grammes` : u.half ? `une demie ${u.u}` : `1 ${u.u}`;
    $('[data-qstep="-1"]', box).setAttribute('aria-label', `${stepLabel} de moins`);
    $('[data-qstep="1"]', box).setAttribute('aria-label', `${stepLabel} de plus`);
    $('#qtyHint', box).textContent = mode < 0 ? '' : `1 ${u.u}${u.about ? ' : environ' : ' :'} ${fmtNum(u.g)} g${u.about ? ', poids moyen.' : '.'}`;
    $('#qtyErr', box).textContent = '';
    if (r.err) { $('#qtyEq', box).textContent = ''; onChange?.(null); return; }
    const m = dietItemMacros({ g: r.g, per }), kcal = data.dietHideNumbers ? null : dietN(m.kcal);
    const shown = `${r.por ? `${portionText(r.por.n, r.por)} · ` : ''}${r.g} g${kcal !== null ? ` · ${kcal} kcal` : ''}`;
    const spoken = `${r.por ? `${portionSpoken(r.por.n, r.por)}, ` : ''}${r.g} grammes${kcal !== null ? `, ${kcal} kilocalories` : ''}`;
    $('#qtyEq', box).innerHTML = dietSrPair(esc(shown), esc(spoken));
    onChange?.(r);
  };
  box.addEventListener('click', ev => {
    const mb = ev.target.closest('[data-qmode]'), sb = ev.target.closest('[data-qstep]');
    if (mb) {
      const next = Number(mb.dataset.qmode);
      if (next === mode) return;
      // Conversion : 2 œufs → 100 g ; 120 g → 2 œufs (arrondi au pas de l'unité)
      const r = dietQtyValue(units, mode, input.value);
      const g = r.err ? null : r.g;
      mode = next;
      if (g !== null) input.value = fmtV(mode < 0 ? g : portionClampN(g / units[mode].g, units[mode]));
      paint();
      haptic('light');
    } else if (sb) {
      const dir = Number(sb.dataset.qstep), cur = num(input.value, 0, Infinity) ?? 0;
      if (mode < 0) input.value = String(Math.min(DIET_G_MAX, Math.max(1, Math.round(cur / QTY_G_STEP) * QTY_G_STEP + dir * QTY_G_STEP)));
      else { const s = portionStep(units[mode]); input.value = fmtV(Math.min(PORTION_N_MAX, Math.max(s, portionClampN(cur || s, units[mode]) + dir * s))); }
      paint();
      haptic('light');
    }
  });
  input.addEventListener('input', paint);
  paint();
  return () => {
    const r = dietQtyValue(units, mode, input.value);
    if (r.err) { $('#qtyErr', box).textContent = r.err; return null; }
    return r;
  };
}

// Feuille de quantité : { g, por } (por null en grammes) ou null. init : aliment du plan ({ g, por }) pour une
// modification. Sans unité connue : la saisie en grammes d'avant (alerte à champ)
async function dietAskQty(food, init = null) {
  const units = dietQtyUnits(food, init?.por);
  if (!units.length) {
    const g = await dietAskGrams(food, init?.g ?? 100);
    return g == null ? null : { g: Math.round(g), por: null };
  }
  const st = dietQtyInit(units, init);
  let read = null;
  const title = food.name.length > 60 ? `${food.name.slice(0, 58)}…` : food.name;
  const p = sheet({ title, confirm: 'OK', body: dietQtyHtml(units, st), onConfirm: () => read?.() || false });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  read = dietQtyBind(root, units, st, food.per);
  return p;
}
