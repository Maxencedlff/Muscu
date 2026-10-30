// ═══════════════════════════════════════════════════════════
//  Outils de la séance : feuille « Disques » (js/data/plates.js) et feuille « Échauffement » (js/data/warmup.js)
//  Feuilles non bloquantes de la séance (openSessSheet, js/features/session-sheets.js)
// ═══════════════════════════════════════════════════════════
'use strict';

// ── Disques ─────────────────────────────────────────────────
let pl = null;   // { ei, si, target } : série visée et cible en cours (unité affichée)

// Pas des −/+ : une paire du plus petit disque
function plStep() { const { plates } = plateSetup(); return 2 * Math.min(...plates); }

// Cible de départ : charge de la série, sinon celle de la dernière fois, sinon la barre
function plInitialTarget(s) {
  const kg = s?.weight !== '' && s?.weight != null ? s.weight : s?.prev?.weight;
  const v = toUnitW(kg);
  return v !== null && v > 0 ? v : plateSetup().bar;
}

// Dessin d'un côté de la barre : manchon, puis les disques du plus lourd (contre le collier) au plus léger,
// hauteur et épaisseur proportionnelles au poids ; le poids sous chaque disque
function plDrawHtml(perSide, plates) {
  const maxP = Math.max(...plates, ...perSide, 1);
  const W = 320, H = 132, barY = 60, x0 = 18;
  let x = x0 + 26;
  const rects = perSide.map(p => {
    const h = Math.round(34 + 78 * Math.sqrt(p / maxP));
    const w = Math.round(9 + 15 * (p / maxP));
    const el = `<rect class="pl__plate" x="${x}" y="${barY - h / 2}" width="${w}" height="${h}" rx="3"/>
      <text class="pl__pw" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${fmtNum(p)}</text>`;
    x += w + 4;
    return el;
  }).join('');
  const sleeveEnd = Math.max(x + 30, 150);
  return `<svg class="pl__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${perSide.length ? `Un côté de la barre : ${platesText(perSide)}` : 'Barre à vide'}">
      <rect class="pl__bar" x="0" y="${barY - 5}" width="${Math.min(W, sleeveEnd)}" height="10" rx="2"/>
      <rect class="pl__collar" x="${x0}" y="${barY - 16}" width="22" height="32" rx="3"/>
      ${rects}
    </svg>`;
}

// Texte du résultat : « Par côté : 20 + 10 · 80 kg » ; cible inatteignable : la charge la plus proche
function plResultHtml(r, target, unit) {
  const u = unit === 'lb' ? 'lb' : 'kg';
  if (r.belowBar) return `<span class="pl__warn">Sous le poids de la barre (${fmtNum(r.total)} ${u})</span>`;
  const side = `Par côté : <b>${platesText(r.perSide)}</b>`;
  if (r.exact) return `${side} · ${fmtNum(r.total)} ${u}`;
  return `${side} · <span class="pl__warn">${fmtNum(r.total)} ${u} au plus proche</span> (cible ${fmtNum(target)} ${u})`;
}

// Jeu de disques proposé : les disques standard de l'unité et ceux ajoutés par la personne, du plus lourd au plus léger
function plChoices(setup) {
  return [...new Set([...PLATE_SETS[setup.unit], ...setup.plates])].sort((a, b) => b - a);
}

function platesSheetHtml() {
  const setup = plateSetup(), u = setup.unit === 'lb' ? 'lb' : 'kg';
  const ex = activeSession.exercises[pl.ei];
  const r  = platesPerSide(pl.target, setup.bar, setup.plates);
  const s  = ex.sets[pl.si];
  const cur = toUnitW(s?.weight);
  // La charge atteignable diffère de celle inscrite dans la série à faire : un toucher la reporte
  const apply = s && !s.done && !r.belowBar && r.total !== cur
    ? `<button class="pl__apply" data-action="pl-apply">Mettre ${fmtNum(r.total)} ${u} dans la série</button>` : '';
  return `
    <div class="rs rs--plates pl">
      <div class="rs__title">Disques · ${esc(ex.name)}</div>
      <div class="pl__target">
        <button class="rs__round num" data-action="pl-adj" data-d="-1" aria-label="Moins ${fmtNum(plStep())} ${u}">−</button>
        <div class="pl__val num" aria-live="polite"><span id="plTarget">${fmtNum(pl.target)}</span> <span class="pl__unit">${u}</span></div>
        <button class="rs__round num" data-action="pl-adj" data-d="1" aria-label="Plus ${fmtNum(plStep())} ${u}">+</button>
      </div>
      ${plDrawHtml(r.perSide, setup.plates)}
      <div class="pl__result num" aria-live="polite">${plResultHtml(r, pl.target, setup.unit)}</div>
      ${apply}
      <div class="pl__row">
        <span class="pl__lbl">Barre</span>
        <div class="rs-seg pl__bars" role="group" aria-label="Poids de la barre">
          ${BAR_CHOICES[setup.unit].map(b => `<button class="rs-seg__btn num" data-action="pl-bar" data-bar="${b}" aria-pressed="${setup.bar === b}">${fmtNum(b)} ${u}</button>`).join('')}
        </div>
      </div>
      <div class="pl__row pl__row--top">
        <span class="pl__lbl">Disques</span>
        <div class="pl__chips" role="group" aria-label="Disques disponibles">
          ${plChoices(setup).map(p => `<button class="ax__chip num" data-action="pl-plate" data-plate="${p}" aria-pressed="${setup.plates.includes(p)}" aria-label="Disque de ${fmtNum(p)} ${u}${setup.plates.includes(p) ? ', disponible' : ', absent'}">${fmtNum(p)}</button>`).join('')}
          <button class="ax__chip" data-action="pl-other" aria-label="Ajouter un autre disque">${icon('plus', 14)} Autre</button>
        </div>
      </div>
      <button class="rs__done" data-action="sheet-done">OK</button>
    </div>`;
}

function openPlatesSheet(ei, si) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  pl = { ei, si, target: plInitialTarget(ex.sets[si]) };
  openSessSheet({ cls: 'sess-sheet--plates', label: 'Disques', html: platesSheetHtml(), onClose: () => { pl = null; } });
}
// Redessine la feuille ouverte (cible, barre ou disques changés)
function refreshPlatesSheet() {
  const body = document.querySelector('.sess-sheet--plates .sess-sheet__body');
  if (body && pl) body.innerHTML = platesSheetHtml();
}
// Barre et disques mémorisés (data.plates, propre à l'appareil)
function savePlates(patch) {
  const u = plateUnit(), cur = data.plates || {};
  const next = cleanPlates({ ...cur, ...patch, bar: { ...(cur.bar || {}), ...(patch.bar || {}) } });
  if (next) data.plates = next; else delete data.plates;
  save();
}

// ── Échauffement ────────────────────────────────────────────
let wuEi = null;

// Séries proposées pour l'exercice (unité affichée), arrondies à la barre et aux disques ou au pas des racks
function warmupProposal(ex) {
  const base = toUnitW(warmupBaseKg(ex));
  if (!(base > 0)) return [];
  const setup = plateSetup();
  return warmupSets(base, v => roundLoad(v, { ...setup, barbell: isBarbellExercise(ex) }));
}

function warmupSheetHtml(ei) {
  const ex = activeSession.exercises[ei], u = unitLbl();
  const base = toUnitW(warmupBaseKg(ex));
  const sets = warmupProposal(ex);
  const first = workSets(ex.sets).find(s => !s.done);
  const goal  = first ? (String(first.reps ?? '').trim() || setGoal(ex, first)) : '';
  const rows = sets.map(s => `
        <div class="wu__row num">
          <span class="wu__pct">${Math.round(s.pct * 100)} %</span>
          <span class="wu__set">${fmtNum(s.load)} ${u} × ${s.reps}</span>
        </div>`).join('');
  return `
    <div class="rs rs--warmup wu">
      <div class="rs__title">Échauffement · ${esc(ex.name)}</div>
      <div class="wu__sub num">Avant ${fmtNum(base)} ${u}${goal ? ` × ${esc(goal)}` : ''}</div>
      ${sets.length ? `<div class="wu__list" role="list">${rows}</div>` : '<div class="wu__empty">Charge trop légère pour un échauffement : commence directement.</div>'}
      <p class="wu__note">Montée en charge en trois paliers, de moins en moins de répétitions : une convention courante
        (dans l'esprit du NSCA et de Starting Strength), arrondie à ce que tu peux charger. Ces séries sont marquées
        « Échauffement » et ne comptent ni dans le volume ni dans les records.</p>
      ${sets.length ? `<button class="rs__done rs__done--primary" data-action="wu-add">Ajouter ${plural(sets.length, 'série', 'séries')}</button>` : ''}
    </div>`;
}

function openWarmupSheet(ei) {
  if (!activeSession?.exercises[ei]) return;
  wuEi = ei;
  openSessSheet({ cls: 'sess-sheet--warmup', label: 'Échauffement', html: warmupSheetHtml(ei), onClose: () => { wuEi = null; } });
}

// Séries d'échauffement insérées avant les séries de travail ; « Annuler » les retire tant qu'aucune n'est faite
function addWarmup(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex || !canWarmup(ex)) return;
  const sets = warmupProposal(ex);
  if (!sets.length) return;
  const added = sets.map(s => ({ weight: storeW(String(s.load)), reps: String(s.reps), plannedWeight: storeW(String(s.load)), prev: null, done: false, warmup: true }));
  ex.sets.unshift(...added);
  cancelEffort();   // les positions des séries changent
  editingSet = null;
  activeSession.lastDone = null;
  closeSessSheets();
  haptic();
  persistSession();
  render();
  showToast(`Échauffement ajouté : ${plural(added.length, 'série', 'séries')}`, { action: 'Annuler', duration: 5000, onAction: () => {
    if (!activeSession || activeSession.exercises[ei] !== ex || added.some(s => s.done)) return;
    ex.sets = ex.sets.filter(s => !added.includes(s));
    persistSession();
    render();
  } });
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'open-plates': (e, el) => {
    openPlatesSheet(parseInt(el.dataset.ei), parseInt(el.dataset.si));
  },
  'pl-adj': (e, el) => {
    if (!pl) return;
    const step = plStep(), max = toUnitW(MAX_LOAD_KG);
    pl.target = Math.min(max, Math.max(0, Math.round((pl.target + step * parseInt(el.dataset.d)) * 100) / 100));
    haptic();
    refreshPlatesSheet();
  },
  'pl-bar': (e, el) => {
    if (!pl) return;
    savePlates({ bar: { [plateUnit()]: parseFloat(el.dataset.bar) } });
    haptic();
    refreshPlatesSheet();
  },
  'pl-plate': (e, el) => {
    if (!pl) return;
    const u = plateUnit(), p = parseFloat(el.dataset.plate), cur = plateSetup().plates;
    const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p];
    if (!next.length) { showToast('Garde au moins un disque'); return; }
    savePlates({ [u]: next });
    haptic();
    refreshPlatesSheet();
  },
  'pl-other': async () => {
    if (!pl) return;
    const u = plateUnit();
    const v = await askNumber({ title: 'Autre disque', message: `Poids d'un disque, en ${u === 'lb' ? 'lb' : 'kg'} (0,25 à 50).`, value: '', unit: u === 'lb' ? 'lb' : 'kg', min: PLATE_MIN, max: PLATE_MAX, decimal: true });
    if (v === null || !pl) return;
    savePlates({ [u]: [...plateSetup().plates, Math.round(v * 4) / 4] });
    refreshPlatesSheet();
  },
  // La charge atteignable remplace celle de la série visée (série à faire seulement)
  'pl-apply': () => {
    if (!pl) return;
    const ex = activeSession?.exercises[pl.ei], s = ex?.sets[pl.si];
    if (!s || s.done) return;
    const r = platesPerSide(pl.target, plateSetup().bar, plateSetup().plates);
    s.weight = storeW(String(r.total));
    pl.target = r.total;
    haptic();
    persistSession();
    render();
    refreshPlatesSheet();
    showToast(`Série ${setDisplayNo(ex.sets, pl.si)} : ${fmtW(s.weight, { plain: true })} ${unitLbl()}`);
  },
  'wu-add': () => {
    if (wuEi !== null) addWarmup(wuEi);
  },
});
