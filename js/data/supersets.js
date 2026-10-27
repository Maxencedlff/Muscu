// ═══════════════════════════════════════════════════════════
//  Supersets : exercices enchaînés sans repos, faits tour par tour
// ═══════════════════════════════════════════════════════════
//
// Un groupe = des exercices CONSÉCUTIFS qui portent le même identifiant `ss` (programme, séance en
// cours et historique). Deux exercices font un superset, trois un tri-set, quatre ou cinq un circuit.
// Un `ss` isolé (exercice déplacé ou retiré) ne forme pas de groupe : ssNormalize l'efface.
// Affichage : tour t = la série t de chaque exercice du groupe. Enchaînement : après un exercice, on
// passe au suivant du groupe qui a encore une série à faire ; après le dernier, repos (celui du dernier
// exercice du groupe). On le décide par l'ordre du groupe, pas par le numéro de série : un exercice
// sauté (machine prise) ou remplacé en cours de route ne décale rien.
'use strict';

const SS_MAX    = 5;
const SS_ID_RE  = /^[a-z0-9]{1,12}$/;

const ssId = ex => (typeof ex?.ss === 'string' && SS_ID_RE.test(ex.ss) ? ex.ss : null);

// Blocs de la liste : [[0], [1, 2], [3]] — un groupe de plusieurs indices, ou un exercice seul
function ssBlocks(xs) {
  const blocks = [];
  xs.forEach((ex, i) => {
    const prev = blocks.at(-1);
    if (prev && ssId(ex) && ssId(ex) === ssId(xs[prev.at(-1)])) prev.push(i); else blocks.push([i]);
  });
  return blocks;
}

// Indices du groupe de l'exercice i, ou null s'il est seul
function ssGroupOf(xs, i) {
  const b = ssBlocks(xs).find(bl => bl.includes(i));
  return b && b.length > 1 ? b : null;
}

// Lettre de chaque groupe dans l'ordre de la liste (A, B…) et place dans le groupe : { 2: 'A1', 3: 'A2' }
function ssTags(xs) {
  const tags = {};
  let n = 0;
  ssBlocks(xs).forEach(b => {
    if (b.length < 2) return;
    const letter = String.fromCharCode(65 + (n++ % 26));
    b.forEach((ei, k) => { tags[ei] = `${letter}${k + 1}`; });
  });
  return tags;
}

// « Superset », « Tri-set », « Circuit »
function ssKind(n) { return n >= 4 ? 'Circuit' : n === 3 ? 'Tri-set' : 'Superset'; }

// Tours d'un groupe : [[{ei, si}, …], …] ; un exercice qui a moins de séries manque aux derniers tours
function ssRounds(xs, members) {
  const n = Math.max(0, ...members.map(ei => xs[ei].sets.length));
  return Array.from({ length: n }, (_, si) => members.filter(ei => xs[ei].sets[si]).map(ei => ({ ei, si })));
}

const ssTodo = (xs, ei) => { const si = xs[ei].sets.findIndex(s => !s.done); return si >= 0 ? { ei, si } : null; };
const ssDone = (xs, ei) => xs[ei].sets.filter(s => s.done).length;

// Exercice qui suit ei dans le groupe et a encore une série à faire (null : fin du tour, repos)
function ssChainAfter(xs, members, ei) {
  for (const k of members.slice(members.indexOf(ei) + 1)) { const c = ssTodo(xs, k); if (c) return c; }
  return null;
}

// Prochaine série à faire du groupe (null si tout est fait). Après l'exercice last : le suivant du
// groupe, sinon on repart au début (nouveau tour). Sans last : le moins avancé, le premier à égalité.
function ssNextSet(xs, members, last = null) {
  if (members.includes(last)) {
    const c = ssChainAfter(xs, members, last);
    if (c) return c;
    for (const k of members) { const t = ssTodo(xs, k); if (t) return t; }
    return null;
  }
  let best = null;
  members.forEach(k => { if (ssTodo(xs, k) && (best === null || ssDone(xs, k) < ssDone(xs, best))) best = k; });
  return best === null ? null : ssTodo(xs, best);
}

// Réunit les exercices de chaque groupe à la place du premier d'entre eux (un exercice glissé au milieu
// d'un superset passe juste après lui). Modifie la liste.
function ssGather(xs) {
  const out = [], seen = new Set();
  xs.forEach(ex => {
    const id = ssId(ex);
    if (!id) { out.push(ex); return; }
    if (seen.has(id)) return;
    seen.add(id);
    out.push(...xs.filter(e => ssId(e) === id));
  });
  xs.splice(0, xs.length, ...out);
  return xs;
}

// Efface les `ss` qui ne forment plus de groupe (exercice seul, déplacé, retiré). Modifie la liste.
function ssNormalize(xs) {
  ssBlocks(xs).forEach(b => { if (b.length < 2) delete xs[b[0]].ss; });
  xs.forEach(ex => { if (ex.ss !== undefined && !ssId(ex)) delete ex.ss; });
  return xs;
}

function ssNewId(xs) {
  const used = new Set(xs.map(ssId).filter(Boolean));
  let id;
  do id = Math.random().toString(36).slice(2, 8); while (!SS_ID_RE.test(id) || used.has(id));
  return id;
}

// Groupe de l'exercice i avec les exercices `others` (indices). Les membres sont réunis à la place
// du premier d'entre eux, dans leur ordre d'avant ; ceux du groupe d'avant non choisis en sortent.
// Renvoie la nouvelle liste (mêmes objets) ; `others` vide = plus de groupe autour de i.
function ssRegroup(xs, i, others) {
  const old    = ssGroupOf(xs, i) || [i];
  const chosen = [...new Set([i, ...others])].filter(k => k >= 0 && k < xs.length).sort((a, b) => a - b).slice(0, SS_MAX);
  const id     = ssId(xs[i]) && old.length > 1 ? ssId(xs[i]) : ssNewId(xs);
  old.forEach(k => { if (!chosen.includes(k)) delete xs[k].ss; });
  if (chosen.length < 2) { delete xs[i].ss; return ssNormalize([...xs]); }
  // Un membre d'un autre groupe le quitte (il ne peut être que dans un seul)
  chosen.forEach(k => { xs[k].ss = id; });
  const members = chosen.map(k => xs[k]);
  const out = [];
  xs.forEach((ex, k) => {
    if (k === chosen[0]) out.push(...members);
    else if (!chosen.includes(k)) out.push(ex);
  });
  // Un exercice décoché au milieu de l'ancien groupe ne le coupe pas : il passe juste après
  return ssNormalize(out);
}

// L'exercice i quitte son groupe et passe juste après lui ; les autres restent ensemble s'ils sont
// encore au moins deux. Renvoie la nouvelle liste (mêmes objets).
function ssLeave(xs, i) {
  const g = ssGroupOf(xs, i);
  if (!g) return xs;
  const ex = xs[i], rest = g.filter(k => k !== i);
  const out = ssRegroup(xs, rest[0], rest.slice(1)).filter(e => e !== ex);
  const after = out.indexOf(xs[g.at(-1) === i ? g.at(-2) : g.at(-1)]);
  out.splice(after + 1, 0, ex);
  return out;
}

// Monter (-1) ou descendre (+1) l'exercice i. Dans un groupe : seulement à l'intérieur du groupe.
// Seul : il passe par-dessus le bloc voisin entier (un groupe n'est jamais coupé).
// Renvoie la nouvelle liste, ou null si le déplacement est impossible.
function ssMove(xs, i, dir) {
  const blocks = ssBlocks(xs);
  const bi = blocks.findIndex(b => b.includes(i));
  const b  = blocks[bi];
  if (b.length > 1) {
    const k = b.indexOf(i) + dir;
    if (k < 0 || k >= b.length) return null;
    const out = [...xs];
    [out[i], out[b[k]]] = [out[b[k]], out[i]];
    return out;
  }
  const nb = blocks[bi + dir];
  if (!nb) return null;
  const order = [...blocks];
  [order[bi], order[bi + dir]] = [order[bi + dir], order[bi]];
  return order.flat().map(k => xs[k]);
}

// Peut-on monter / descendre l'exercice i ? (pour le menu ⋯)
function ssCanMove(xs, i, dir) { return ssMove(xs, i, dir) !== null; }
