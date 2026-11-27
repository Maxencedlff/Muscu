// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : tableaux et mise en page.
//  - Tableau en texte (copier-coller d'Excel ou de Google Sheets, extraction d'un PDF) : colonnes séparées par des
//    tabulations, des « | » ou plusieurs espaces, ligne d'en-tête reconnue (Exercice, Séries, Reps, Repos, Charge,
//    Tempo, RPE, RIR, Notes ; en français ou en anglais). Chaque rangée devient une ligne ordinaire (« Squat 4 séries
//    8-10 reps repos 90 s ») que la grammaire (js/data/plan-grammar.js) lit comme le reste.
//  - Texte lu sur une photo (Apple Vision) ou dans un PDF (pdf.js) : morceaux de texte avec leur position, remis en
//    lignes et en colonnes (planTextFromBoxes) ; les cases vides d'un tableau restent à leur place.
//  Logique pure, sans écran.
// ═══════════════════════════════════════════════════════════
'use strict';

// Colonnes reconnues dans un en-tête (texte de la case en minuscules, sans accents)
const PARSE_COLS = [
  ['session', /^(?:seances?|jours?|day|session|workout|entrainement)$/],
  ['week1', /^(?:semaine|sem\.?|week|s)\s*1$/], ['weekN', /^(?:semaine|sem\.?|week|s)\s*(?:[2-9]|1[0-9])$/],
  ['name', /^(?:exercices?|exercise?s?|mouvements?|movements?|exos?|nom|name|lift)$/],
  ['setsReps', /^(?:series?\s*(?:x|×|\*)\s*(?:reps?|repetitions?)|sets?\s*(?:x|×|\*)\s*reps?|volume|prescription|schema|s\s*x\s*r)$/],
  ['sets', /^(?:series?|sets?|nb\.?\s*(?:de\s*)?series?|nombre\s+de\s+series|s|tours?)$/],
  ['reps', /^(?:reps?|repetitions?|rep\.?|repet\.?|r|nb\.?\s*reps?|reps?\s*(?:cible|vise)s?|duree|temps|time)$/],
  ['rest', /^(?:repos|recup(?:eration)?\.?|rest|pause|repos\s*\(s\)|repos\s*\(min\))$/],
  ['load', /^(?:charges?|poids|kg|load|weight|intensite|%\s*1rm|%|%\s*max|charge\s*\(kg\))$/],
  ['tempo', /^tempo$/], ['rpe', /^rpe$/], ['rir', /^rir$/],
  ['notes', /^(?:notes?|remarques?|consignes?|commentaires?|comments?|technique|methode|conseils?|details?|info|modalites?)$/],
  // Numéro de machine ou de fiche (« N° 21 ») : jamais des séries ni des reps
  ['num', /^(?:n°|no|n|num(?:ero)?|#|ref|machine|poste)$/],
  // Colonne qui forme les groupes (« Muscles (superset) », « Biset ») : les rangées qui la partagent sont enchaînées
  ['group', /\b(?:super\s*-?\s*sets?|bi\s*-?\s*sets?|tri\s*-?\s*sets?|circuit)\b/],
];
// Colonnes qui prescrivent : une rangée de tableau sans aucune d'elles n'est pas un exercice prescrit
const PARSE_TABLE_DOSE = ['sets', 'reps', 'setsReps', 'rest', 'load', 'tempo', 'rpe', 'rir'];
// Mots d'en-tête reconnus malgré une faute de lecture (« Sérles », « Repo5 », « Exerclce »)
const PARSE_COL_WORDS = { exercice: 'name', exercices: 'name', exercise: 'name', mouvement: 'name', series: 'sets', sets: 'sets', reps: 'reps',
  repetitions: 'reps', repos: 'rest', recup: 'rest', recuperation: 'rest', charge: 'load', poids: 'load', tempo: 'tempo', notes: 'notes', remarques: 'notes', seance: 'session' };
function planColKind(cell) {
  const k = planPlain(planDeOcr(planTidy(cell))).replace(/[.:*#]+$/g, '').replace(/\s+/g, ' ').trim();
  const hit = PARSE_COLS.find(([, re]) => re.test(k))?.[0];
  if (hit) return hit;
  const w = k.replace(/\s*\(.*\)$/, '');
  const wk = k.match(/^(\S+)\s*(\d{1,2})$/);
  if (wk && editDistance(wk[1], 'semaine', 1) <= 1) return wk[2] === '1' ? 'week1' : 'weekN';
  if (w.length < 4) return null;
  const near = Object.keys(PARSE_COL_WORDS).find(x => editDistance(w, x, 1) <= 1);
  return near ? PARSE_COL_WORDS[near] : null;
}

// Cases d'une ligne : séparateur tabulation, « | » ou au moins deux espaces (dans cet ordre de préférence).
// Renvoie { cells: [{ text, at }], sep } ; at : position du début de la case dans la ligne (alignement par espaces)
function planCells(line) {
  const s = String(line);
  let sep = null;
  if (s.includes('\t')) sep = 'tab';
  else if ((s.match(/\|/g) || []).length >= 2 || /\S\s*\|\s*\S/.test(s)) sep = 'pipe';
  else if (/\S {2,}\S/.test(s)) sep = 'space';
  if (!sep) return { cells: [{ text: s.trim(), at: 0 }], sep: null };
  const re = sep === 'tab' ? /\t/ : sep === 'pipe' ? /\|/ : / {2,}/;
  const cells = [];
  let at = 0;
  for (const part of s.split(new RegExp(`(${re.source})`))) {
    if (re.test(part) && part.trim() === '' || part === '|') { at += part.length; continue; }
    const lead = part.length - part.trimStart().length;
    cells.push({ text: part.trim(), at: at + lead });
    at += part.length;
  }
  // « | a | b | » : cases vides du bord retirées ; les cases vides du milieu (tabulations) gardent leur place
  if (sep === 'pipe') { while (cells.length && !cells[0].text) cells.shift(); while (cells.length && !cells.at(-1).text) cells.pop(); }
  return { cells, sep };
}

// En-tête de tableau : au moins deux colonnes connues, dont le nom ou les séries / reps. Renvoie { cols, sep } ou null
function planTableHeader(line) {
  const { cells, sep } = planCells(line);
  if (!sep || cells.length < 2) return null;
  const cols = cells.map(c => ({ kind: planColKind(c.text), at: c.at }));
  const known = cols.filter(c => c.kind);
  if (known.length < 2 || known.length < cells.length * 0.5) return null;
  if (!known.some(c => ['name', 'sets', 'reps', 'setsReps', 'week1'].includes(c.kind))) return null;
  if (!cols.some(c => c.kind === 'name')) {
    const first = cols.findIndex(c => !c.kind);
    if (first >= 0) cols[first].kind = 'name'; else if (cols[0].kind !== 'sets') { cols.unshift({ kind: 'name', at: 0 }); var addedName = true; }
  }
  // Pas une colonne qui prescrit (« Jours | Groupes musculaires ») : un planning de la semaine, pas des exercices
  const schedule = !cols.some(c => PARSE_TABLE_DOSE.includes(c.kind) || c.kind === 'week1');
  return { cols, sep, schedule, dosed: !schedule, addedName: !!addedName };
}
// Nom coupé sur deux rangées (« Développé incliné » puis « haltères  3  10 ») : la suite commence par une minuscule ; une
// rangée suivante qui commence par une majuscule, c'est un autre exercice (fiche de salle : catalogue sans prescription
// au-dessus de l'exercice prescrit)
function planTableJoin(pending, name) {
  if (/^\s*\p{Lu}/u.test(name) && /^\s*\p{Lu}/u.test(pending)) return name;
  return `${pending} ${name}`.trim();
}
// Case fusionnée sur tout un tableau (repos « 1 min » écrit une fois, au milieu de la colonne) : quand un seul exercice
// du tableau a un repos, pris dans sa case, et qu'il n'est pas le premier de trois exercices ou plus, ce repos vaut
// pour tous les exercices du tableau
function planTableMergedRest(items) {
  const byTable = new Map();
  items.forEach(it => { if (it.tbl) { if (!byTable.has(it.tbl)) byTable.set(it.tbl, []); byTable.get(it.tbl).push(it); } });
  for (const list of byTable.values()) {
    const withRest = list.filter(it => it.tblRest && it.presc.rest !== undefined);
    if (list.length < 3 || withRest.length !== 1 || withRest[0] === list[0]) continue;
    list.forEach(it => { if (it.presc.rest === undefined) it.presc.rest = withRest[0].presc.rest; });
  }
}

// Case → colonne de l'en-tête : par rang (tabulations, « | »), par position la plus proche (espaces alignés)
function planRowCells(line, head) {
  const { cells, sep } = planCells(line);
  if (!sep && cells.length === 1) return cells[0].text && !/^\d/.test(cells[0].text) && cells[0].text.length <= 60 ? { name: cells[0].text, single: true } : null;
  const out = {};
  const put = (kind, text) => { if (kind && text) out[kind] = out[kind] ? `${out[kind]} ${text}` : text; };
  if (head.sep === 'space' && sep === 'space' && cells.length !== head.cols.length) {
    // Colonne dont le début est le plus à droite sans dépasser la case (deux caractères de marge), sinon la plus proche
    cells.forEach(c => {
      let best = -1;
      head.cols.forEach((h, i) => { if (h.at <= c.at + 2) best = i; });
      if (best < 0) best = 0;
      const nxt = head.cols[best + 1];
      if (nxt && Math.abs(nxt.at - c.at) < Math.abs(head.cols[best].at - c.at) && c.at + c.text.length > nxt.at) best++;
      put(head.cols[best].kind || 'notes', c.text);
    });
  } else {
    // En-tête sans colonne de nom (« Répétitions | Charges ») : une rangée de même largeur que lui n'a pas de nom (carte :
    // le nom est sur la ligne au-dessus de l'en-tête)
    const cols = head.addedName && cells.length < head.cols.length && /^\d/.test(cells[0]?.text || '') ? head.cols.slice(1) : head.cols;
    cells.forEach((c, i) => put(cols[i]?.kind || 'notes', c.text));
  }
  // Semaines en colonnes (« Semaine 1 … Semaine 4 ») : la première fait la prescription, les autres sont ignorées
  if (out.week1) { out.setsReps = out.setsReps || out.week1; delete out.week1; }
  delete out.weekN;
  return out;
}

// Charges homme / femme sans unité d'un tableau de WOD (« 95/65 », « 20/14 ») : la plus lourde d'abord
function planRxPair(t) { const m = String(t).trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/); return !!m && +m[1] > +m[2]; }
// Rangée sans en-tête (« Squat | 4 | 8-10 | 90 ») : première case de texte = nom, nombres seuls dans l'ordre séries, reps, repos
function planBareRow(line) {
  const { cells, sep } = planCells(line);
  if (!sep || cells.length < 3) return null;
  const texts = cells.map(c => c.text).filter(Boolean);
  const numeric = t => /^\d{1,3}(?:\s*[-/à]\s*\d{1,3})*(?:\s*(?:s|sec|min|'|"|kg|%|reps?))?$/i.test(t) || /^\d{1,2}\s*[x×*]\s*\d{1,3}/i.test(t);
  const nameIdx = texts.findIndex(t => !numeric(t));
  if (nameIdx < 0 || texts.filter(numeric).length < 2) return null;
  // « 36 | DEADLIFTS | 185/135 » : reps devant le nom et charges homme / femme, lus par la grammaire comme une ligne
  if (nameIdx === 1 && /^\d{1,3}$/.test(texts[0]) && texts.slice(2).every(t => !numeric(t) || planRxPair(t))) return null;
  const out = { name: texts[nameIdx] };
  // Reps série par série (« Squats | 315 LB | 5 | 5 | 5 | 5 | 5 », carnet « DL : 5|5|3|2|1 ») : quatre nombres seuls ou
  // plus, côte à côte et sans unité, donnent les séries et la fourchette de reps
  const bareInts = texts.map((t, i) => (i !== nameIdx && /^\d{1,2}$/.test(t) ? +t : null));
  let runStart = -1, best = null;
  bareInts.forEach((v, i) => {
    if (v !== null && v >= 1 && v <= 30) { if (runStart < 0) runStart = i; if (i - runStart + 1 >= 4) best = [runStart, i]; }
    else runStart = -1;
  });
  if (best) {
    // « DL : 5 | 5 | 3 » : le premier nombre est resté collé au nom
    const glued = best[0] === nameIdx + 1 && texts[nameIdx].match(/^(.*\S)\s*[:\s]\s*(\d{1,2})$/);
    if (glued) { out.name = glued[1]; bareInts[nameIdx] = +glued[2]; best[0] = nameIdx; }
    const reps = bareInts.slice(best[0], best[1] + 1);
    out.setsReps = `${reps.length} x ${Math.min(...reps)}${Math.max(...reps) > Math.min(...reps) ? `-${Math.max(...reps)}` : ''}`;
    // Charge avant les reps ; ce qui suit (« GREAT! +5 LB NEXT TIME ») est un commentaire de l'appli, laissé de côté
    texts.forEach((t, i) => { if (i !== nameIdx && i < best[0] && /kg|lb|%/i.test(t)) out.load = t; });
    return out;
  }
  const order = ['sets', 'reps', 'rest', 'load'];
  let k = 0;
  texts.forEach((t, i) => {
    if (i === nameIdx) return;
    if (!numeric(t)) { out.notes = out.notes ? `${out.notes} ${t}` : t; return; }
    if (/[x×*]/i.test(t) && /^\d{1,2}\s*[x×*]/.test(t)) { out.setsReps = t; k = Math.max(k, 2); return; }
    if (/kg|%/i.test(t)) { out.load = t; return; }
    out[order[k++] || 'notes'] = t;
  });
  return out;
}

// Rangée → ligne ordinaire pour la grammaire. Nombres seuls interprétés selon la colonne : repos « 90 » = 90 s,
// « 2 » = 2 min ; charge « 80 » = 80 kg ; « 45 s » dans la colonne des reps = exercice en durée
function planRowText(row) {
  const bits = [row.name || ''];
  const bare = v => /^\d+(?:[.,]\d+)?$/.test(String(v).trim());
  if (row.setsReps) bits.push(row.setsReps);
  if (row.sets && row.reps && /\d\s*(?:s|sec|secondes?|''|"|min|')\s*$/i.test(row.reps)) bits.push(`${row.sets} x ${row.reps}`);
  else {
    if (row.sets) bits.push(bare(row.sets) ? `${row.sets} séries` : row.sets);
    if (row.reps) bits.push(/^(?:max|amrap|échec|echec)/i.test(row.reps) ? `${row.reps} reps` : /\d\s*$/.test(row.reps) ? `${row.reps} reps` : row.reps);
  }
  if (row.rest) {
    // Case de repos : seulement sa durée (« 15 sec max » donne 15 s ; « max » n'est pas une rep)
    const r0 = String(row.rest).trim(), tm = planPlain(r0).match(new RegExp(PARSE_TIME_SRC));
    let r = tm && tm[0].trim() !== r0 ? r0.slice(tm.index, tm.index + tm[0].length).trim() : r0;
    // Consigne écrite dans la case (« On passe d'un bras à l'autre sans pause ») : sans repos si elle le dit, sinon une note
    if (!tm) { if (/\b(?:sans|pas\s+de|aucune?)\s+(?:pause|repos|r[ée]cup)/i.test(r0)) r = 'pas de repos'; else if (!/^\d/.test(r0)) { row.notes = row.notes ? `${row.notes} ${r0}` : r0; r = ''; } }
    if (r) bits.push(bare(r) ? `repos ${planDec(r) <= 10 ? `${r.replace(',', '.')} min` : `${r} s`}` : /repos|rest|r[ée]cup/i.test(r) ? r : `repos ${r}`);
  }
  if (row.load) bits.push(bare(row.load) ? `${row.load} kg` : row.load);
  if (row.tempo) bits.push(`tempo ${row.tempo}`);
  if (row.rpe) bits.push(bare(row.rpe) ? `RPE ${row.rpe}` : row.rpe);
  if (row.rir) bits.push(bare(row.rir) ? `RIR ${row.rir}` : row.rir);
  if (row.notes) bits.push(`(${row.notes})`);
  return bits.filter(Boolean).join('  ').replace(/\s+/g, ' ').trim();
}

// Décor d'une capture d'écran ou d'une page : barre d'état (« 9:41 », « TELCEL 3G 10:44 a.m. », « 4G 87 % »), pied de
// page (« 1 of 1 », « Page 2/3 »). Une ligne ainsi faite n'est jamais un exercice
const PARSE_NOISE = [
  /^\s*(?:[a-z]{2,12}\s+)?(?:(?:3|4|5)g\s+|lte\s+|wi-?fi\s+|edge\s+)?\d{1,2}[:h]\d{2}(?:\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))?(?:\s+(?:(?:3|4|5)g|lte|wi-?fi|\d{1,3}\s*%))*\s*$/,
  /^\s*(?:[a-z]{2,12}\s+)?(?:3|4|5)g\b.*\d{1,2}:\d{2}/,
  /^\s*(?:page\s*)?\d{1,3}\s*(?:of|sur|\/|de)\s*\d{1,3}\s*$/,
];
function planNoiseLine(line) {
  const low = planPlain(planTidy(line)).replace(/[|•·\-–]+/g, ' ').replace(/\s+/g, ' ').trim();
  return !!low && low.length <= 40 && PARSE_NOISE.some(re => re.test(low));
}

// ── Texte placé (photo, PDF) ─────────────────────────────────
// items : [{ text, x, y, w, h }] en coordonnées de la page (origine en haut à gauche, y vers le bas), unités libres.
// Lignes : morceaux qui se chevauchent en hauteur ; dans une ligne, un écart de plus de 1,2 hauteur de texte ouvre
// une nouvelle case. Colonnes : débuts de case regroupés sur toutes les rangées d'un bloc, pour que la case vide d'une
// rangée laisse sa place (« Squat · · 90 s » reste sous Repos). Renvoie le texte, cases séparées par des tabulations.
function planTextFromBoxes(items, { maxItems = 4000, glue = true } = {}) {
  const list = (Array.isArray(items) ? items : []).slice(0, maxItems)
    .map(it => ({ text: planTidy(String(it?.text ?? '')).trim(), x: +it?.x, y: +it?.y, w: Math.max(0, +it?.w || 0), h: Math.max(0, +it?.h || 0) }))
    .filter(it => it.text && [it.x, it.y, it.w, it.h].every(Number.isFinite));
  if (!list.length) return '';
  list.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const rows = [];
  // Deux morceaux d'une même rangée sont côte à côte : un morceau qui chevauche en largeur ceux d'une rangée (photo
  // de biais, ligne penchée) ouvre la sienne au lieu d'y être mêlé
  const sideBySide = (r, it) => r.items.every(o => Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x) <= Math.min(o.w, it.w) * 0.3);
  for (const it of list) {
    const cy = it.y + it.h / 2;
    let row = null;
    for (const r of rows) if (Math.abs(r.cy - cy) <= Math.max(r.h, it.h) * 0.5 && sideBySide(r, it) && (!row || Math.abs(r.cy - cy) < Math.abs(row.cy - cy))) row = r;
    if (row) { row.items.push(it); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; row.h = Math.max(row.h, it.h); }
    else rows.push({ cy, h: it.h, items: [it] });
  }
  rows.sort((a, b) => a.cy - b.cy);
  const hMed = [...list.map(i => i.h)].sort((a, b) => a - b)[Math.floor(list.length / 2)] || 1;
  rows.forEach(r => {
    r.items.sort((a, b) => a.x - b.x);
    r.cells = [];
    for (const it of r.items) {
      const last = r.cells.at(-1);
      // Morceaux collés d'un PDF (écart nul, une ou deux lettres d'une autre police : « sé » « A » « nces ») : un seul mot.
      // Pas sur une photo (glue faux) : les mots de Vision écrits serrés restent des mots
      const gap = it.x - (last?.x + last?.w);
      const glued = glue && gap < it.h * 0.12 && (it.text.length <= 2 || last?.short);
      if (last && gap <= hMed * 1.2) { last.text += glued ? it.text : ` ${it.text}`; last.w = it.x + it.w - last.x; last.short = it.text.length <= 2; }
      else r.cells.push({ text: it.text, x: it.x, w: it.w, short: it.text.length <= 2 });
    }
  });
  // Blocs de rangées à plusieurs cases qui se suivent : colonnes communes
  const out = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].cells.length < 2) { out.push(rows[i].cells.map(c => c.text).join(' ')); i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].cells.length >= 2) j++;
    const block = rows.slice(i, j);
    const anchors = planColumnAnchors(block.flatMap(r => r.cells.map(c => c.x)), hMed * 2);
    for (const r of block) {
      const slots = Array(anchors.length).fill('');
      r.cells.forEach(c => {
        let k = 0;
        anchors.forEach((a, n) => { if (Math.abs(a - c.x) < Math.abs(anchors[k] - c.x)) k = n; });
        slots[k] = slots[k] ? `${slots[k]} ${c.text}` : c.text;
      });
      out.push(slots.join('\t').replace(/\t+$/, ''));
    }
    i = j;
  }
  return out.join('\n');
}
// Débuts de colonne : positions x regroupées (écart de moins de gap) ; la moyenne de chaque groupe, de gauche à droite
function planColumnAnchors(xs, gap) {
  const sorted = [...xs].sort((a, b) => a - b), groups = [];
  for (const x of sorted) {
    const g = groups.at(-1);
    if (g && x - g.at(-1) <= gap) g.push(x); else groups.push([x]);
  }
  return groups.map(g => g.reduce((s, v) => s + v, 0) / g.length);
}

// Pages lues par Apple Vision (PlanReader, js/platform/plan-reader.js) : { width, height, lines: [{ text, box, words }] },
// boîtes de 0 à 1, origine en haut à gauche. Les mots gardent leur place (une ligne de Vision peut traverser deux
// colonnes d'un tableau) ; une ligne sans mots compte d'un bloc. Pages mises l'une sous l'autre, séparées d'une ligne vide
function planTextFromPages(pages) {
  const items = [];
  let top = 0;
  for (const p of (Array.isArray(pages) ? pages : []).slice(0, 50)) {
    const W = p?.width > 0 ? p.width : 1000, H = p?.height > 0 ? p.height : 1400;
    const put = (t, b) => { if (t && b) items.push({ text: t, x: b.x * W, y: top + b.y * H, w: b.w * W, h: b.h * H }); };
    for (const l of Array.isArray(p?.lines) ? p.lines : []) {
      const words = Array.isArray(l?.words) ? l.words.filter(w => w?.text && w.box) : [];
      if (!words.length || !l?.box) { put(String(l?.text ?? ''), l?.box); continue; }
      // Mots d'une ligne de Vision tous à la hauteur du centre de la ligne (une ligne penchée reste une rangée), et
      // hauts comme le plus petit mot : la boîte d'une ligne de biais est bien plus haute que son texte
      const cy = l.box.y + l.box.h / 2, h = Math.min(l.box.h, ...words.map(w => w.box.h).filter(v => v > 0));
      words.forEach(w => put(String(w.text), { x: w.box.x, w: w.box.w, y: cy - h / 2, h }));
    }
    top += H + 60;
  }
  return planTextFromBoxes(items, { glue: false });
}
