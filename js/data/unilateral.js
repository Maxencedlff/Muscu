// ═══════════════════════════════════════════════════════════
//  Exercices unilatéraux : une série notée « par bras » (ou par jambe), chaque côté avec sa saisie et ses
//  sous-séries (drop set, rest-pause, cluster). Logique pure ; l'écran est dans js/features/session-unilateral.js.
//  Chargé avant store.js : volumeSets (js/data/intensif.js) compte le second côté dès le chargement.
//  Décisions : docs/UNILATERAL.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Une série de travail peut porter side2 : le second côté, { weight, reps, sub? } (sub : ses sous-séries, rangées
// comme celles de la série, seulement si la série a une technique à sous-séries). La série elle-même reste le
// premier côté : son nombre, sa place, « Avant », le RIR et la note ne changent pas. En séance, side2 a aussi done,
// auto (charge encore reprise du premier côté) et prev (le second côté de la même série la dernière fois).
// Une version précédente de l'app ignore side2 : elle voit le premier côté seul (volume du second en moins).
//
// Règles (docs/UNILATERAL.md) :
//  - volume et total de reps : les deux côtés, sous-séries comprises (volumeSets) ;
//  - nombre de séries, séries par muscle : une série pour les deux côtés ;
//  - records, 1RM estimé, meilleure série, cible de la prochaine séance : le meilleur des deux côtés
//    (recordSet), jamais leur somme ; une sous-série ne bat toujours aucun record ;
//  - repos : seulement après le dernier bloc du second côté (aucune pause pour changer de côté).

// Membre de chaque exercice unilatéral de la bibliothèque (UNILATERAL_EXERCISES, js/data/exercise-catalogue.js), sinon
// lu dans le nom saisi (« Élévation latérale à un bras », « Leg extension unilatérale »)
const UNI_NAME_RE = /\b(unilateral\w*|un bras|1 bras|une main|one arm|single arm|une jambe|1 jambe|single leg)\b/;
const UNI_LEG_RE  = /jambe|leg|fente|bulgare|pistol|squat|pont fessier|hip thrust|mollet|calf/;
const SIDE_NAMES  = { bras: ['Bras gauche', 'Bras droit'], jambe: ['Jambe gauche', 'Jambe droite'] };

// 'bras', 'jambe' ou null : exercice en répétitions qui se fait d'un côté puis de l'autre
function unilateralLimb(ex) {
  if (!ex?.name || measureOf(ex) !== 'reps') return null;
  const own = UNILATERAL_EXERCISES[catalogueEntry(ex.name)?.name];
  if (own) return own;
  const k = ruleKey(ex.name);
  return UNI_NAME_RE.test(k) ? (UNI_LEG_RE.test(k) ? 'jambe' : 'bras') : null;
}
// « Bras gauche » (side 1), « Bras droit » (side 2) ; « Côté 1 » si le membre est inconnu
function sideName(ex, side) {
  const n = SIDE_NAMES[unilateralLimb(ex)];
  return n ? n[side - 1] : `Côté ${side}`;
}

function hasSide2(s) { return !!s && !isWarmupSet(s) && !!s.side2 && typeof s.side2 === 'object'; }
// Sous-séries du second côté : celles de l'historique, et en séance celles qui sont validées
function side2SubsOf(s) {
  if (!hasSide2(s) || !techHasSub(setTech(s)) || !Array.isArray(s.side2.sub)) return [];
  return s.side2.sub.filter(x => x && typeof x === 'object' && x.done !== false);
}
// Séries du volume venues du second côté : lui (validé) puis ses sous-séries
function side2VolumeSets(s) {
  if (!hasSide2(s) || s.side2.done === false) return [];
  return [s.side2, ...side2SubsOf(s)];
}

// ── Records : le meilleur côté ───────────────────────────────
// Série vue par les records : la série, ou son second côté s'il est meilleur (1RM estimé, puis charge, puis reps).
// Le second côté renvoyé est une copie de la série avec ses valeurs ; of garde la série d'origine (badges en direct).
const sideKey = y => [calc1RM(y.weight, y.reps) || 0, parseFloat(y.weight) || 0, parseInt(y.reps) || 0];
function recordSet(s) {
  if (!hasSide2(s) || s.side2.done === false || !(parseInt(s.side2.reps) > 0)) return s;
  const a = sideKey(s), b = sideKey(s.side2);
  const better = b[0] !== a[0] ? b[0] > a[0] : b[1] !== a[1] ? b[1] > a[1] : b[2] > a[2];
  return better ? { ...s, weight: s.side2.weight, reps: s.side2.reps, side: 2, of: s } : s;
}
function recordSets(sets) { return workSets(sets).map(recordSet); }
// Série d'origine d'une série vue par les records
function recordSource(s) { return s?.of || s; }

// ── Nettoyage ────────────────────────────────────────────────
// Champ side2 nettoyé, à étaler dans une série enregistrée : {} sans second côté. doneOnly : la séance qui s'enregistre
// (second côté et sous-séries validés seulement). Ses sous-séries ne restent que si la série garde sa technique.
function sideFields(s, { doneOnly = false } = {}) {
  if (!hasSide2(s) || (doneOnly && s.side2.done !== true)) return {};
  const base = cleanSubSet(s.side2);
  if (!base) return {};
  const t = techFields(s, { doneOnly }).tech;
  const src = techHasSub(t) && Array.isArray(s.side2.sub) ? s.side2.sub : [];
  const sub = src.filter(x => !doneOnly || x?.done === true).slice(0, TECH_SUB_MAX).map(cleanSubSet).filter(Boolean);
  return { side2: { ...base, ...(sub.length ? { sub } : {}) } };
}
// Série de l'historique corrigée en place (cleanHistoryEntry) : une série sans side2 n'est pas touchée
function cleanSideSet(st) {
  if (st.side2 === undefined) return;
  const f = sideFields(st);
  delete st.side2;
  Object.assign(st, f);
}

// ── Séance en cours ──────────────────────────────────────────
// Sous-série k du second côté, nouvelle : la même la dernière fois (même technique) pour l'objectif
function newSide2Sub(s, k) {
  const p = s?.prev?.side2 && s.prev.tech === s.tech && Array.isArray(s.prev.side2.sub) ? cleanSubSet(s.prev.side2.sub[k]) : null;
  return { weight: '', reps: '', done: false, auto: true, prev: p };
}
// Le second côté posé sur s (série à faire) : charge reprise du premier côté (auto), reps du premier côté une fois fait.
// byTech : posé par une technique à sous-séries (il part avec elle s'il n'est pas fait). false s'il y était déjà.
function addSide2(s, { byTech = false } = {}) {
  if (!s || isWarmupSet(s) || hasSide2(s)) return false;
  const prev = s.prev?.side2 ? cleanSubSet(s.prev.side2) : null;
  s.side2 = { weight: '', reps: '', done: false, auto: true, prev, ...(byTech ? { byTech: true } : {}) };
  syncSide2Subs(s);
  return true;
}
function removeSide2(s) {
  if (!hasSide2(s) || s.side2.done) return false;
  delete s.side2;
  return true;
}
// Les sous-séries du second côté suivent celles du premier (autant, pour la même technique) ; les validées restent
function syncSide2Subs(s) {
  if (!hasSide2(s)) return;
  const x = s.side2, n = techHasSub(setTech(s)) ? (s.sub || []).length : 0;
  if (!n) { if (!(x.sub || []).some(y => y?.done)) delete x.sub; return; }
  x.sub = (x.sub || []).slice(0, Math.max(n, (x.sub || []).filter(y => y?.done).length));
  while (x.sub.length < n) x.sub.push(newSide2Sub(s, x.sub.length));
}
// Charge (kg stockés) et reps du second côté : saisies, sinon celles du premier côté (« pré-remplir avec ce qui a été
// fait » : un ✓ suffit quand les deux côtés sont pareils), sinon la dernière fois
function side2WeightKg(s) {
  if (!hasSide2(s)) return '';
  return s.side2.auto ? (s.weight ?? '') : (s.side2.weight ?? '');
}
function side2RepsGoal(s) {
  if (!hasSide2(s)) return '';
  return String(s.side2.reps ?? '').trim() || String(s.reps ?? '').trim() || s.side2.prev?.reps || '';
}
// Sous-série k du second côté : la charge et les reps de la même sous-série du premier côté
function side2SubWeightKg(s, k, opts = {}) {
  const x = s?.side2?.sub?.[k];
  if (!x) return '';
  return x.auto ? subWeightKg(s, k, opts) : (x.weight ?? '');
}
function side2SubRepsGoal(s, k) {
  const x = s?.side2?.sub?.[k];
  if (!x) return '';
  return String(x.reps ?? '').trim() || String(s.sub?.[k]?.reps ?? '').trim() || x.prev?.reps || '';
}

// ── Enchaînement d'une série ─────────────────────────────────
// Étapes d'une série dans l'ordre où elles se font : la série (premier côté), ses sous-séries, le second côté, ses
// sous-séries. { side: 1 | 2, k: -1 (la ligne du côté) ou rang de la sous-série, x }.
function setSteps(s) {
  if (!s) return [];
  const subs = (host, side) => (techHasSub(setTech(s)) && Array.isArray(host?.sub) ? host.sub : []).map((x, k) => ({ side, k, x }));
  const out = [{ side: 1, k: -1, x: s }, ...subs(s, 1)];
  if (hasSide2(s)) out.push({ side: 2, k: -1, x: s.side2 }, ...subs(s.side2, 2));
  return out;
}
// Étape qui suit dans une série validée : la première à faire après la dernière validée ; null quand tout est fait.
// Une étape sautée (une plus loin est validée) n'est plus « à faire » : elle reste à remplir.
function setNextStep(s) {
  if (!s?.done) return null;
  const steps = setSteps(s);
  let last = 0;
  steps.forEach((st, i) => { if (st.x?.done) last = i; });
  return steps.slice(last + 1).find(st => st.x && !st.x.done) || null;
}

// Choix du menu ⋯ › Plus d'options d'un exercice de la séance (js/features/session-sheets.js) : chaque côté à part, ou
// les deux ensemble (toggleSides, js/features/session-unilateral.js).
// Seulement sur un exercice unilatéral (rien de nouveau ailleurs). Une série à sous-séries s'y note déjà par côté
// d'elle-même (techSides) ; ce choix vaut pour toutes les séries de travail à faire.
function sideMenuActions(ex) {
  const limb = unilateralLimb(ex), todo = workSets(ex.sets).filter(s => !s.done);
  if (!limb || !todo.length) return [];
  const all = todo.every(hasSide2), plural = limb === 'jambe' ? 'jambes' : 'bras';
  return [{ label: all ? `Noter les deux ${plural} ensemble` : `Noter chaque ${limb} à part`, value: 'sides' }];
}

// ── Textes ───────────────────────────────────────────────────
// Lignes de l'historique : « Série 3, bras droit : 12 kg × 9 · drop set 10 kg × 6 » pour chaque série notée par côté.
// ex : l'exercice (nom et mesure) pour le nom du côté. [] sans second côté.
function sideLines(ex, sets, kind = 'charge') {
  return workSets(sets).map((s, i) => {
    if (!hasSide2(s) || s.side2.done === false) return '';
    const subs = side2SubsOf(s).map(x => measureSetTxt(x, 'reps', kind)).join(' · ');
    return `Série ${i + 1}, ${sideName(ex, 2).toLowerCase()} : ${measureSetTxt(s.side2, 'reps', kind)}${subs ? ` · ${TECHS[setTech(s)].label.toLowerCase()} ${subs}` : ''}`;
  }).filter(Boolean);
}
