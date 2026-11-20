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
// Premier côté de l'exercice : 'gauche' (par défaut) ou 'droit', choisi par exercice (⋯ › Plus d'options › « Commencer
// par le bras droit », data.sideFirst par nom) et gardé dans la séance (ex.sideFirst) pour que l'historique reste juste
function sideFirstOf(ex) { return ex?.sideFirst === 'droit' ? 'droit' : 'gauche'; }
function sideFirstPref(name, d = typeof data === 'undefined' ? null : data) {
  return d?.sideFirst?.[exerciseNameKey(name)] === 'droit' ? 'droit' : 'gauche';
}
function setSideFirstPref(name, v, d = data) {
  const k = exerciseNameKey(name);
  if (!k) return;
  if (v === 'droit') (d.sideFirst ||= {})[k] = 'droit';
  else if (d.sideFirst) { delete d.sideFirst[k]; if (!Object.keys(d.sideFirst).length) delete d.sideFirst; }
}
// Choix gardé (sanitizeData) : { nom normalisé: 'droit' } seulement, 200 noms au plus
function cleanSideFirst(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = Object.fromEntries(Object.entries(v).filter(([k, x]) => typeof k === 'string' && k.length <= 120 && x === 'droit').slice(0, 200));
  return Object.keys(out).length ? out : undefined;
}
// « Bras gauche » (side 1), « Bras droit » (side 2), ou l'inverse si l'exercice commence par le droit ; « Côté 1 » si
// le membre est inconnu
function sideName(ex, side) {
  const n = SIDE_NAMES[unilateralLimb(ex)];
  if (!n) return `Côté ${side}`;
  return n[(sideFirstOf(ex) === 'droit' ? 2 - side : side - 1)];
}
// « bras gauche » / « jambe droite » en minuscules
function sideWord(ex, side) { return sideName(ex, side).toLowerCase(); }
// Le côté seul, sans le membre : « Gauche », « Droit », « Droite » (colonne du numéro)
function sideShort(ex, side) { const w = sideName(ex, side).split(' ').pop(); return w.charAt(0).toUpperCase() + w.slice(1); }

// Nom parlé d'un champ (« Charge du bras gauche, en kilos », « Répétitions de la jambe droite ») ; what : 'w' ou 'r'
function sideFieldName(ex, side, what) {
  const of = `${unilateralLimb(ex) === 'jambe' ? 'de la' : 'du'} ${sideWord(ex, side)}`;
  if (what === 'r') return `Répétitions ${of}`;
  return `${loadKind(ex) === 'aide' ? 'Aide' : loadKind(ex) === 'lest' ? 'Charge ajoutée' : 'Charge'} ${of}, en ${data.unit === 'lbs' ? 'livres' : 'kilos'}`;
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
// « Avant » du second côté : ce côté la dernière fois ; une série notée sur une seule ligne valait pour les deux bras
// (panel du 20/11 : « — » dans Avant alors que la dernière fois existait)
function side2PrevOf(prev) {
  if (!prev) return null;
  return cleanSubSet(prev.side2 && typeof prev.side2 === 'object' ? prev.side2 : prev);
}
// Sous-série k du second côté, nouvelle : la même la dernière fois (même technique) pour l'objectif
function newSide2Sub(s, k) {
  const p = s?.prev && s.prev.tech === s.tech ? (s.prev.side2 && typeof s.prev.side2 === 'object' ? s.prev.side2 : s.prev) : null;
  return { weight: '', reps: '', done: false, auto: true, prev: Array.isArray(p?.sub) ? cleanSubSet(p.sub[k]) : null };
}
// Le second côté posé sur s : charge reprise du premier côté (auto), reps du premier côté une fois fait. Série déjà
// validée : le second côté est noté à l'identique, validé (sous-séries validées comprises), corrigeable au toucher.
// false s'il y était déjà.
function addSide2(s) {
  if (!s || isWarmupSet(s) || hasSide2(s)) return false;
  s.side2 = { weight: '', reps: '', done: false, auto: true, prev: side2PrevOf(s.prev) };
  syncSide2Subs(s);
  if (s.done) {
    Object.assign(s.side2, { weight: s.weight ?? '', reps: String(s.reps ?? ''), done: true });
    delete s.side2.auto;
    (s.side2.sub || []).forEach((x, k) => {
      const y = s.sub?.[k];
      if (!y?.done) return;
      Object.assign(x, { weight: y.weight ?? '', reps: String(y.reps ?? ''), done: true });
      delete x.auto;
    });
  }
  return true;
}
function removeSide2(s) {
  if (!hasSide2(s)) return false;
  delete s.side2;
  return true;
}
// Tout l'exercice par bras : chaque série de travail (panel du 20/11 : couper la seule série 3 mélangeait un bras et
// deux bras, le volume devenait faux). Renvoie le nombre de séries changées.
function exSides(ex) {
  return workSets(ex?.sets).reduce((n, s) => n + (addSide2(s) ? 1 : 0), 0);
}
// Premier bras changé (ou différent de la dernière fois) : « Avant » de chaque ligne suit son bras. Série à faire
// seulement : les valeurs de la dernière fois passent d'une ligne à l'autre, et la charge et les reps pré-remplies avec
// elles si la personne n'y a pas touché.
function swapSidePrev(s) {
  if (!hasSide2(s) || s.done || s.side2.done || !s.prev || !s.side2.prev) return false;
  const a = { weight: s.prev.weight, reps: s.prev.reps }, b = { weight: s.side2.prev.weight, reps: s.side2.prev.reps };
  const untouched = String(s.weight ?? '') === String(a.weight ?? '') && String(s.reps ?? '') === String(a.reps ?? '');
  Object.assign(s.prev, b);
  Object.assign(s.side2.prev, a);
  if (untouched) { s.weight = b.weight ?? ''; s.reps = String(b.reps ?? ''); s.plannedWeight = s.weight; }
  (s.sub || []).forEach((x, k) => {
    const y = s.side2.sub?.[k];
    if (x && y && !x.done && !y.done) [x.prev, y.prev] = [y.prev, x.prev];
  });
  return true;
}
// Exercice noté par bras (au moins une série) : une série ajoutée l'est aussi
function exBySide(ex) { return workSets(ex?.sets).some(hasSide2); }
// Série finie : la série, son second côté et les sous-séries de celui-ci (le compteur « 3/3 » et la barre du haut ne
// comptent une série notée par bras qu'une fois le bras droit fait, panel du 20/11)
function setComplete(s) {
  if (!s?.done) return false;
  if (!hasSide2(s)) return true;
  return s.side2.done === true && !(techHasSub(setTech(s)) ? s.side2.sub || [] : []).some(x => x && !x.done);
}

// ── Comparaisons d'une séance à l'autre ───────────────────────
// Exercice unilatéral : une série notée sur une seule ligne valait pour les deux bras. Pour comparer (volume gagné,
// tendance du bilan, courbe de Progrès), elle compte donc deux fois, comme une série notée par bras : refaire 14 × 10
// à l'identique donne +0, que l'une ou l'autre fois soit notée par bras (panel du 20/11 : « +140 kg » faux).
// Exercice à deux bras : les séries telles quelles.
function comparableSets(ex, sets) {
  if (!unilateralLimb(ex)) return sets || [];
  return (sets || []).map(s => (isWarmupSet(s) || hasSide2(s) || s?.done === false ? s
    : { ...s, side2: { weight: s.weight, reps: s.reps, ...(subSetsOf(s).length ? { sub: subSetsOf(s).map(x => ({ weight: x.weight, reps: x.reps })) } : {}) } }));
}
function comparableVolume(ex, sets, bodyKg = null) { return exVolume(ex, comparableSets(ex, sets), bodyKg); }
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
// Tant que le premier côté n'est pas fait, le second montre ce qu'il a fait la dernière fois (« pré-remplir avec la
// dernière fois », panel du 20/11 : le bras gauche affichait les 8 reps prévues au droit sous un « Avant 14 × 10 »)
function side2WeightKg(s) {
  if (!hasSide2(s)) return '';
  if (!s.side2.auto) return s.side2.weight ?? '';
  return !s.done && s.side2.prev ? (s.side2.prev.weight ?? '') : (s.weight ?? '');
}
function side2RepsGoal(s) {
  if (!hasSide2(s)) return '';
  const own = String(s.side2.reps ?? '').trim();
  if (own) return own;
  if (!s.done && s.side2.prev?.reps) return String(s.side2.prev.reps);
  return String(s.reps ?? '').trim() || s.side2.prev?.reps || '';
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
// Seulement sur un exercice unilatéral (rien de nouveau ailleurs). Une technique à sous-séries y passe déjà tout l'exercice
// par bras (techSides) ; ce choix vaut pour toutes ses séries de travail.
function sideMenuActions(ex) {
  const limb = unilateralLimb(ex), work = workSets(ex?.sets);
  if (!limb || !work.length) return [];
  const all = work.every(hasSide2), plural = limb === 'jambe' ? 'jambes' : 'bras';
  const other = SIDE_NAMES[limb][sideFirstOf(ex) === 'droit' ? 0 : 1].toLowerCase();
  return [
    { label: all ? `Noter les deux ${plural} ensemble` : `Noter chaque ${limb} à part`, value: 'sides' },
    // Le premier bras ne compte que noté par bras, et se choisit avant la première série (après, il dirait qu'une série
    // faite d'un bras l'a été de l'autre)
    ...(all && !work.some(s => s.done) ? [{ label: `Commencer par ${limb === 'jambe' ? 'la' : 'le'} ${other}`, value: 'side-first' }] : []),
  ];
}

// ── Textes ───────────────────────────────────────────────────
// Lignes de l'historique d'un exercice noté par bras : « Bras droit : 14 kg × 10, 10, 9 » (les séries du second côté,
// comme la ligne des séries), puis ses sous-séries « Drop set série 3, bras droit : 10 kg × 5 ». La ligne des séries
// du premier côté est nommée par sidePrefix. ex : l'exercice (nom, mesure, premier bras). [] sans second côté.
function sideLines(ex, sets, kind = 'charge') {
  const work = workSets(sets), two = work.filter(s => hasSide2(s) && s.side2.done !== false);
  if (!two.length) return [];
  const lines = [`${sideName(ex, 2)} : ${setsTextRead(two.map(s => s.side2), 'reps', kind)}`];
  work.forEach((s, i) => {
    const subs = hasSide2(s) ? side2SubsOf(s).map(x => measureSetTxt(x, 'reps', kind)).join(' · ') : '';
    if (subs) lines.push(`${TECHS[setTech(s)].label} série ${i + 1}, ${sideWord(ex, 2)} : ${subs}`);
  });
  return lines;
}
// « Bras gauche : » devant la ligne des séries d'un exercice noté par bras, '' sinon
function sidePrefix(ex, sets) { return workSets(sets).some(hasSide2) ? `${sideName(ex, 1)} : ` : ''; }
