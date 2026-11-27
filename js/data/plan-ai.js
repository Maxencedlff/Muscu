// ═══════════════════════════════════════════════════════════
//  Import d'un programme : renfort de l'IA (docs/IMPORT_IA.md), logique pure sans écran ni réseau.
//  Le moteur gratuit (js/data/plan-parser.js) lit toujours d'abord, sur le téléphone. Claude ne vient qu'en renfort,
//  par la fonction serveur plan-import-ai :
//   - planAiAdvice(brouillon) : faut-il le proposer (le moteur hésite), et quoi envoyer : seulement les lignes
//     douteuses avec leur contexte (mode lines), ou tout le texte quand presque rien n'est sûr (mode plan) ;
//   - planAiLinesBody / planAiPlanBody : le corps de la demande, rien d'autre que du texte du plan (le nom de l'élève,
//     s'il y figure, est masqué par planAiRedact) ;
//   - planAiApplyLines / planAiAdopt : le résultat remis dans le brouillon, même forme, même écran « Vérifier » ;
//   - planAiLearnable : ce qu'une correction de l'IA validée par le coach apprend au moteur (dictionnaire appris), pour
//     qu'il sache la refaire seul la fois suivante.
// ═══════════════════════════════════════════════════════════
'use strict';

const PAI_TARGETS_MAX = 40, PAI_LINE_MAX = 300, PAI_CTX_MAX = 200, PAI_SESSION_MAX = 40;
const PAI_PLAN_CHARS = 20000, PAI_PLAN_LINES = 600;
// Le moteur hésite : au moins une ligne pas comprise, ou deux douteuses, ou une ligne sur cinq
const PAI_PROPOSE_RATIO = 0.2;
// Au-delà de la moitié des lignes douteuses (ou trop de lignes pour le mode lines), tout le texte part : le
// découpage même du moteur est alors suspect
const PAI_PLAN_RATIO = 0.5;

const paiItems = draft => (draft?.sessions || []).flatMap(s => s.items.filter(it => !it.removed));
// Ligne non reprise qui porte un nombre : peut-être un exercice manqué par le moteur (« Burpees x 20 »)
const paiMaybeExercise = t => { const s = String(t || '').trim(); return s.length >= 3 && s.length <= 160 && /[a-zà-ÿ]{3}/i.test(s) && /\d/.test(s); };

// { propose, mode: 'lines' | 'plan' | null, targets: [{ item } | { note }], doubtful, total }
function planAiAdvice(draft, { text = '' } = {}) {
  const items = paiItems(draft);
  const doubtful = items.filter(it => it.level !== 'sure');
  const unknown = doubtful.filter(it => it.level === 'unknown').length;
  const notes = (draft?.lines || []).filter(l => l.role === 'note' && paiMaybeExercise(l.text));
  const total = items.length;
  // Lignes douteuses : exercices à vérifier ou pas compris, et lignes non reprises qui ressemblent à un exercice
  const weak = doubtful.length + notes.length, seen = total + notes.length;
  const propose = (!total && !!String(text).trim()) || unknown >= 1 || weak >= 2 || (seen > 0 && weak / seen >= PAI_PROPOSE_RATIO);
  const targets = [...doubtful.map(item => ({ item })), ...notes.map(note => ({ note }))];
  let mode = null;
  if (!total || weak / Math.max(1, seen) > PAI_PLAN_RATIO || targets.length > PAI_TARGETS_MAX) mode = 'plan';
  else if (targets.length) mode = 'lines';
  return { propose, mode, targets: mode === 'lines' ? targets : [], doubtful: weak, total };
}

// Nom de l'élève ou pseudo dans le texte : masqué avant tout envoi (aucun nom ne part, docs/IMPORT_IA.md)
function planAiRedact(text, names = []) {
  let s = String(text ?? '');
  for (const n of names) {
    const v = String(n || '').trim();
    if (v.length < 2) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])@?${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu');
    s = s.replace(re, '…');
  }
  return s;
}

// Contexte d'une ligne du brouillon : séance, ligne non vide d'avant et d'après (dans draft.lines)
function paiContext(draft, rec, item = null) {
  const lines = draft.lines || [];
  let i = lines.indexOf(rec);
  if (i < 0 && item) i = lines.findIndex(l => l.item === item);
  const near = step => { for (let k = i + step; k >= 0 && k < lines.length; k += step) if (lines[k].text.trim()) return lines[k].text; return ''; };
  let session = '';
  if (item) session = (draft.sessions || []).find(s => s.items.includes(item))?.label || '';
  else for (let k = i - 1; k >= 0 && !session; k--) { const it = lines[k].item; if (it) session = (draft.sessions || []).find(s => s.items.includes(it))?.label || ''; }
  return { prev: i >= 0 ? near(-1) : '', next: i >= 0 ? near(1) : '', session };
}
const paiClip = (s, n) => [...String(s ?? '').replace(/\s+/g, ' ').trim()].slice(0, n).join('');

function planAiLinesBody(draft, targets, { names = [] } = {}) {
  return {
    mode: 'lines',
    targets: targets.slice(0, PAI_TARGETS_MAX).map(t => {
      const rec = t.note || (draft.lines || []).find(l => l.item === t.item) || null;
      const c = paiContext(draft, rec, t.item || null);
      const text = t.note ? t.note.text : t.item.src;
      return { text: paiClip(planAiRedact(text, names), PAI_LINE_MAX) || '?', prev: paiClip(planAiRedact(c.prev, names), PAI_CTX_MAX),
        next: paiClip(planAiRedact(c.next, names), PAI_CTX_MAX), session: paiClip(planAiRedact(c.session, names), PAI_SESSION_MAX) };
    }),
  };
}
// Mode plan : les lignes telles que le moteur les a découpées (une dictée recoupée), 20 000 caractères au plus
function planAiPlanBody(text, { names = [] } = {}) {
  const out = [];
  let n = 0;
  for (const l of planSourceLines(planAiRedact(text, names))) {
    if (out.length >= PAI_PLAN_LINES) break;
    const t = [...l].slice(0, 2000).join('');
    if (n + [...t].length > PAI_PLAN_CHARS) break;
    n += [...t].length;
    out.push(t);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { mode: 'plan', lines: out.length ? out : [''] };
}

// Niveau final d'un élément : la grille du moteur (planGrade : nom, matériel, séries, reps), plus ce que le serveur a
// signalé (nombre refusé, nom incertain, ligne illisible)
function paiRegrade(it, serverWhy = []) {
  planGrade(it);
  const why = [...new Set([...(it.why || []), ...serverWhy.filter(w => ['nombre', 'nom', 'illisible'].includes(w))])];
  if (!it.name) why.includes('exercice') || why.unshift('exercice');
  it.why = why;
  it.level = !it.name ? 'unknown' : why.length ? 'check' : 'sure';
}
// Nom lu (la ligne sans sa prescription), pour le dictionnaire appris et « Garder comme nouvel exercice »
function paiRawOf(src) {
  const pieces = planSplitLine(src);
  return pieces.length === 1 ? planReadLine(pieces[0].text).name.slice(0, 80) : '';
}

// Mode lines : chaque résultat { i, name, presc, confidence, level, why } remis sur sa cible. Une ligne non reprise
// lue comme un exercice de la bibliothèque devient un élément, après l'exercice qui la précède. Rend le nombre de lignes changées
function planAiApplyLines(draft, targets, results) {
  let changed = 0, seq = 0;
  for (const r of Array.isArray(results) ? results : []) {
    const t = targets[r?.i];
    if (!t || r.confidence === 'unreadable') continue;
    const presc = r.presc && typeof r.presc === 'object' ? r.presc : {};
    if (t.item) {
      const it = t.item, before = JSON.stringify([it.name, it.presc]);
      if (r.name) { it.name = r.name; it.score = 1; it.how = 'ai'; }
      else if (r.confidence === 'sure') { if (it.name) it.guess = it.guess || it.name; it.name = null; it.how = 'ai'; }
      it.presc = { ...it.presc, ...presc };
      paiRegrade(it, r.why || []);
      it.ai = true;
      if (JSON.stringify([it.name, it.presc]) !== before) changed++;
      continue;
    }
    if (!r.name || r.level === 'unknown' || !planHasWork(presc)) continue;
    const rec = t.note, lines = draft.lines || [];
    const at = lines.indexOf(rec);
    let prevItem = null;
    for (let k = at - 1; k >= 0 && !prevItem; k--) if (lines[k].item) prevItem = lines[k].item;
    const sess = (prevItem && draft.sessions.find(s => s.items.includes(prevItem))) || draft.sessions[0];
    if (!sess) continue;
    const raw = paiRawOf(rec.text) || rec.text.trim().slice(0, 80);
    const it = { id: `ai${++seq}`, src: rec.text, raw, name: r.name, score: 1, how: 'ai', guess: null, presc: { ...presc }, marks: {}, ai: true };
    paiRegrade(it, r.why || []);
    sess.items.splice(prevItem ? sess.items.indexOf(prevItem) + 1 : sess.items.length, 0, it);
    rec.role = 'exercise'; rec.item = it;
    draft.notes = (draft.notes || []).filter(n => n !== rec.text.trim());
    changed++;
  }
  planAiStats(draft);
  return changed;
}
// Mode plan et image : brouillon du serveur, complété comme planParse le ferait (nom lu, supposition du moteur pour
// un exercice hors bibliothèque, niveaux de l'écran)
function planAiAdopt(aiDraft, learned = null) {
  const d = aiDraft && typeof aiDraft === 'object' ? aiDraft : null;
  if (!d || !Array.isArray(d.sessions)) return null;
  for (const s of d.sessions) {
    s.label = String(s.label || '').slice(0, PAI_SESSION_MAX) || 'Séance';
    s.items = (Array.isArray(s.items) ? s.items : []).filter(it => it && typeof it.src === 'string');
    for (const it of s.items) {
      it.name = typeof it.name === 'string' && catalogueEntry(it.name) ? catalogueEntry(it.name).name : null;
      it.raw = paiRawOf(it.src) || String(it.raw || it.src).trim().slice(0, 80);
      it.presc = it.presc && typeof it.presc === 'object' ? it.presc : {};
      it.marks = {};
      if (!it.name) { const m = planMatchExercise(it.raw, learned); if (m.name && m.score >= PARSE_MATCH_MIN) it.guess = m.name; }
      it.ai = true;
      paiRegrade(it, Array.isArray(it.why) ? it.why : []);
    }
  }
  d.sessions = d.sessions.filter(s => s.items.length);
  d.lines = Array.isArray(d.lines) ? d.lines : [];
  d.notes = Array.isArray(d.notes) ? d.notes : [];
  d.cut = { text: false, items: !!d.cut?.items, sessions: !!d.cut?.sessions };
  planAiStats(d);
  return d;
}
function planAiStats(d) {
  const items = paiItems(d);
  d.stats = { items: items.length, sure: items.filter(x => x.level === 'sure').length, check: items.filter(x => x.level === 'check').length,
    unknown: items.filter(x => x.level === 'unknown').length, sessions: (d.sessions || []).filter(s => s.items.length).length };
}

// À l'enregistrement : chaque exercice choisi par l'IA (et laissé tel quel par le coach) entre dans le dictionnaire
// appris, sous les mots lus. Rien pour une ligne à plusieurs exercices, un nom de plus de 5 mots, ou un nom inventé
// { raw: nom } prêt pour planLearnAlias
function planAiLearnable(draft) {
  const out = {};
  for (const it of paiItems(draft)) {
    if (it.how !== 'ai' || !it.name || !catalogueEntry(it.name)) continue;
    const raw = paiRawOf(it.src);
    if (!raw || raw.split(/\s+/).length > 5 || /\d{3,}/.test(raw)) continue;
    out[raw] = it.name;
  }
  return out;
}
