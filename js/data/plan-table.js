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
  ['reps', /^(?:reps?|repetitions?|rep\.?|r|nb\.?\s*reps?|reps?\s*(?:cible|vise)s?|duree|temps|time)$/],
  ['rest', /^(?:repos|recup(?:eration)?\.?|rest|pause|repos\s*\(s\)|repos\s*\(min\))$/],
  ['load', /^(?:charges?|poids|kg|load|weight|intensite|%\s*1rm|%|%\s*max|charge\s*\(kg\))$/],
  ['tempo', /^tempo$/], ['rpe', /^rpe$/], ['rir', /^rir$/],
  ['notes', /^(?:notes?|remarques?|consignes?|commentaires?|comments?|technique|methode|conseils?|details?|info)$/],
];
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
    if (first >= 0) cols[first].kind = 'name'; else if (cols[0].kind !== 'sets') cols.unshift({ kind: 'name', at: 0 });
  }
  return { cols, sep };
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
    cells.forEach((c, i) => put(head.cols[i]?.kind || 'notes', c.text));
  }
  // Semaines en colonnes (« Semaine 1 … Semaine 4 ») : la première fait la prescription, les autres sont ignorées
  if (out.week1) { out.setsReps = out.setsReps || out.week1; delete out.week1; }
  delete out.weekN;
  return out;
}

// Rangée sans en-tête (« Squat | 4 | 8-10 | 90 ») : première case de texte = nom, nombres seuls dans l'ordre séries, reps, repos
function planBareRow(line) {
  const { cells, sep } = planCells(line);
  if (!sep || cells.length < 3) return null;
  const texts = cells.map(c => c.text).filter(Boolean);
  const numeric = t => /^\d{1,3}(?:\s*[-/à]\s*\d{1,3})*(?:\s*(?:s|sec|min|'|"|kg|%|reps?))?$/i.test(t) || /^\d{1,2}\s*[x×*]\s*\d{1,3}/i.test(t);
  const nameIdx = texts.findIndex(t => !numeric(t));
  if (nameIdx < 0 || texts.filter(numeric).length < 2) return null;
  const out = { name: texts[nameIdx] };
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
    const r = String(row.rest).trim();
    bits.push(bare(r) ? `repos ${planDec(r) <= 10 ? `${r.replace(',', '.')} min` : `${r} s`}` : /repos|rest|r[ée]cup/i.test(r) ? r : `repos ${r}`);
  }
  if (row.load) bits.push(bare(row.load) ? `${row.load} kg` : row.load);
  if (row.tempo) bits.push(`tempo ${row.tempo}`);
  if (row.rpe) bits.push(bare(row.rpe) ? `RPE ${row.rpe}` : row.rpe);
  if (row.rir) bits.push(bare(row.rir) ? `RIR ${row.rir}` : row.rir);
  if (row.notes) bits.push(`(${row.notes})`);
  return bits.filter(Boolean).join('  ').replace(/\s+/g, ' ').trim();
}

// ── Texte placé (photo, PDF) ─────────────────────────────────
// items : [{ text, x, y, w, h }] en coordonnées de la page (origine en haut à gauche, y vers le bas), unités libres.
// Lignes : morceaux qui se chevauchent en hauteur ; dans une ligne, un écart de plus de 1,2 hauteur de texte ouvre
// une nouvelle case. Colonnes : débuts de case regroupés sur toutes les rangées d'un bloc, pour que la case vide d'une
// rangée laisse sa place (« Squat · · 90 s » reste sous Repos). Renvoie le texte, cases séparées par des tabulations.
function planTextFromBoxes(items, { maxItems = 4000 } = {}) {
  const list = (Array.isArray(items) ? items : []).slice(0, maxItems)
    .map(it => ({ text: planTidy(String(it?.text ?? '')).trim(), x: +it?.x, y: +it?.y, w: Math.max(0, +it?.w || 0), h: Math.max(0, +it?.h || 0) }))
    .filter(it => it.text && [it.x, it.y, it.w, it.h].every(Number.isFinite));
  if (!list.length) return '';
  list.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const rows = [];
  for (const it of list) {
    const cy = it.y + it.h / 2;
    const row = rows.find(r => Math.abs(r.cy - cy) <= Math.max(r.h, it.h) * 0.5);
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
      if (last && it.x - (last.x + last.w) <= hMed * 1.2) { last.text += ` ${it.text}`; last.w = it.x + it.w - last.x; }
      else r.cells.push({ text: it.text, x: it.x, w: it.w });
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
