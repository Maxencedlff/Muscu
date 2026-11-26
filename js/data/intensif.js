// ═══════════════════════════════════════════════════════════
//  Techniques d'intensification : drop set, rest-pause, cluster (sous-séries notées sous la série),
//  top set et back-off (étiquettes de série). Logique pure ; l'écran est dans
//  js/features/session-intensif.js. Chargé avant store.js : volumeSets sert au volume dès le chargement.
//  Décisions et sources : docs/INTENSIFICATION.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Une série de travail peut porter tech (une clé de TECHS) ; drop, rp et cluster ont en plus sub :
// [{ weight, reps }] (charge en kg stockée, comme weight). En séance, chaque sous-série a aussi done
// (validée), prev (la même sous-série la dernière fois) et auto (charge encore calculée d'après la série,
// tant que la personne n'y a pas touché). Une version précédente de l'app ignore les deux champs : elle
// voit la série seule (le volume des sous-séries lui manque, rien d'autre ne change).
//
// Règles (docs/INTENSIFICATION.md) :
//  - volume : les sous-séries comptent (volumeSets, setsVolume et exVolume de store.js) ;
//  - nombre de séries, séries par muscle, records, 1RM estimé, meilleure série, cible de la prochaine
//    séance : la série seule. Une sous-série n'est jamais un effort séparé (pas de repos complet avant) ;
//  - top set et back-off ne changent aucun calcul : ce sont des séries de travail ordinaires.
const TECHS = {
  drop:    { label: 'Drop set',   short: 'D',  sub: true,  subName: 'drop',   ratio: 0.8, pause: 0,  hint: 'sans repos' },
  // « mini-série » : un seul mot pour la sous-série du rest-pause (plus de « reprise » ni de « RP1 », panels de la vague 3) ;
  // « Reprise » garde un seul sens, la phase du coach. Hint : la pause, en entier à côté du nom (« Rest-pause 15 s »)
  rp:      { label: 'Rest-pause', short: 'RP', sub: true,  subName: 'mini-série', fem: true, ratio: 1,  pause: 15, hint: '15 s' },
  cluster: { label: 'Cluster',    short: 'C',  sub: true,  subName: 'bloc',   ratio: 1,  pause: 20, hint: '20 s' },
  // En français, les mots de l'écran d'envoi du coach (« 1re lourde, puis allégées ») : plus de « Top set » ni de
  // « Back-off » (juges du 26/11 : un même réglage nommé de deux façons, en anglais)
  top:     { label: 'Lourde',     short: 'L',  sub: false, hint: '' },
  backoff: { label: 'Allégée',    short: 'A',  sub: false, hint: 'après la lourde' },
};
const TECH_IDS = Object.keys(TECHS);
const TECH_SUB_MAX = 6;   // sous-séries d'une série

function setTech(s) { return s && !isWarmupSet(s) && Object.hasOwn(TECHS, s.tech) ? s.tech : null; }
function techHasSub(t) { return !!TECHS[t]?.sub; }
// Sous-séries comptées d'une série : celles de l'historique, et en séance celles qui sont validées
function subSetsOf(s) {
  if (!techHasSub(setTech(s)) || !Array.isArray(s.sub)) return [];
  return s.sub.filter(x => x && typeof x === 'object' && x.done !== false);
}
// Séries du volume : séries de travail suivies de leurs sous-séries, puis du second côté d'une série notée par bras
// et de ses sous-séries (side2VolumeSets, js/data/unilateral.js) ; l'échauffement n'y est jamais
function volumeSets(sets) { return workSets(sets).flatMap(s => [s, ...subSetsOf(s), ...side2VolumeSets(s)]); }
// Une technique s'applique aux exercices en répétitions (pas aux maintiens ni au cardio)
function canTech(ex) { return measureOf(ex) === 'reps'; }

// ── Nettoyage ────────────────────────────────────────────────
// Sous-série gardée : { weight: kg en texte ou '' (poids du corps), reps: texte } ; null si inutilisable
function cleanSubSet(x) {
  if (!x || typeof x !== 'object') return null;
  const reps = num(x.reps, 1, MAX_COUNT, true);
  if (reps === null) return null;
  const raw = x.weight;
  let weight = '';
  if (raw !== '' && raw != null) {
    const w = num(raw, 0, MAX_LOAD_KG);
    if (w === null) return null;
    weight = String(w);
  }
  return { weight, reps: String(reps) };
}
// Champs de technique d'une série, nettoyés, à étaler dans une série enregistrée : {} sans technique.
// doneOnly : sous-séries validées seulement (séance qui s'enregistre). Une technique à sous-séries sans
// aucune sous-série gardée disparaît (un drop set sans drop n'en est pas un).
function techFields(s, { doneOnly = false } = {}) {
  const t = setTech(s);
  if (!t) return {};
  if (!techHasSub(t)) return { tech: t };
  const src = (Array.isArray(s.sub) ? s.sub : []).filter(x => !doneOnly || x?.done === true);
  const sub = src.slice(0, TECH_SUB_MAX).map(cleanSubSet).filter(Boolean);
  return sub.length ? { tech: t, sub } : {};
}
// Série de l'historique corrigée en place (cleanHistoryEntry) : une série sans ces champs n'est pas touchée
// (son empreinte de synchro ne change pas)
function cleanTechSet(st) {
  if (st.tech === undefined && st.sub === undefined) return;
  const f = techFields(st);
  delete st.tech; delete st.sub;
  Object.assign(st, f);
}

// ── Prescription d'un programme (coach ou soi) ───────────────
// Champ intens d'un exercice du programme : une clé de INTENS_PLANS, absent sinon
const INTENS_PLANS = {
  'drop-last':    { tech: 'drop',    on: 'last', label: 'Dernière série en drop set',     short: 'dernière en drop set' },
  'drop-all':     { tech: 'drop',    on: 'all',  label: 'Toutes les séries en drop set',  short: 'toutes en drop set' },
  'rp-last':      { tech: 'rp',      on: 'last', label: 'Dernière série en rest-pause',   short: 'dernière en rest-pause' },
  'rp-all':       { tech: 'rp',      on: 'all',  label: 'Toutes les séries en rest-pause', short: 'toutes en rest-pause' },
  'cluster-last': { tech: 'cluster', on: 'last', label: 'Dernière série en cluster',      short: 'dernière en cluster' },
  'cluster-all':  { tech: 'cluster', on: 'all',  label: 'Toutes les séries en cluster',   short: 'toutes en cluster' },
  topback:        { tech: 'top',     on: 'first', label: '1re série lourde, puis allégées', short: '1re lourde, puis allégées' },
};
function cleanIntens(v) { return typeof v === 'string' && Object.hasOwn(INTENS_PLANS, v) ? v : null; }
function intensLabel(v) { return INTENS_PLANS[cleanIntens(v)]?.label || ''; }

// Séries choisies (« Sur quelle série » : retour d'un coach du 24/11, « le cluster en première série ») : champ intensOn
// { plan, sets } de l'exercice, à côté de intens. sets : numéros de série de travail (1 = la première), triés.
// Compatibilité : intens garde une clé d'avant (« cluster-last »), qu'une version précédente de l'app comprend (dernière
// série) et ne retire pas ; intensOn ne vaut que pour cette clé-là (plan) : une ancienne version qui change de technique
// le rend caduc au lieu de poser la nouvelle sur les séries d'avant. « Dernière » et « Toutes » restent les clés d'avant,
// sans intensOn : un programme existant ne change pas. docs/INTENSIFICATION.md, « Sur quelle série »
const INTENS_SETS_MAX = 10;   // séries d'un exercice du programme (sanitizeData)
function cleanIntensOn(v, intens, nSets = INTENS_SETS_MAX) {
  const key = cleanIntens(intens);
  if (!key || INTENS_PLANS[key].on !== 'last' || !v || typeof v !== 'object' || v.plan !== key || !Array.isArray(v.sets)) return null;
  const max = Math.min(INTENS_SETS_MAX, Number.isInteger(nSets) && nSets > 0 ? nSets : INTENS_SETS_MAX);
  const sets = [...new Set(v.sets.filter(n => Number.isInteger(n) && n >= 1 && n <= max))].sort((a, b) => a - b);
  return sets.length ? { plan: key, sets } : null;
}
// Technique d'un exercice du programme pour l'écran (drop, rp, cluster, topback) ; null sans technique
function intensTechOf(ex) {
  const key = cleanIntens(ex?.intens);
  return !key ? null : key === 'topback' ? 'topback' : INTENS_PLANS[key].tech;
}
// Séries visées : 'last', 'all' ou des numéros ; null pour le top set (toujours la 1re, puis back-off) ou sans technique
function intensWhereOf(ex) {
  const key = cleanIntens(ex?.intens), p = INTENS_PLANS[key];
  if (!p || p.on === 'first') return null;
  if (p.on === 'all') return 'all';
  return cleanIntensOn(ex.intensOn, key, ex.sets)?.sets || 'last';
}
// Champs { intens, intensOn? } d'une technique (tech : drop, rp, cluster, topback) posée sur where pour n séries,
// ramenés à la forme la plus simple : la seule dernière série → « X-last » ; toutes → « X-all » (ce qu'une
// version précédente comprend) ; {} sans technique
function intensFieldsFor(tech, where, n) {
  if (tech === 'topback') return { intens: 'topback' };
  if (!TECHS[tech]?.sub) return {};
  const nSets = Math.min(INTENS_SETS_MAX, Math.max(1, parseInt(n) || 1));
  const sets = Array.isArray(where) ? cleanIntensOn({ plan: `${tech}-last`, sets: where }, `${tech}-last`, nSets)?.sets || [] : [];
  if (where === 'all' || (nSets > 1 && sets.length === nSets)) return { intens: `${tech}-all` };
  if (!sets.length || (sets.length === 1 && sets[0] === nSets)) return { intens: `${tech}-last` };
  return { intens: `${tech}-last`, intensOn: { plan: `${tech}-last`, sets } };
}
// « Dernière », « Toutes », « Première », « Série 2 », « Séries 1 et 3 »
function intensWhereText(where) {
  if (where === 'all') return 'Toutes';
  if (!Array.isArray(where) || !where.length) return 'Dernière';
  if (where.length === 1) return where[0] === 1 ? 'Première' : `Série ${where[0]}`;
  return `Séries ${where.slice(0, -1).join(', ')} et ${where.at(-1)}`;
}
// Ce que prescrit l'exercice du programme : « Première série en cluster » (short : « 1re en cluster », liste de la
// séance, écran Envoyer, aperçu de l'élève) ; '' sans technique
function intensText(ex, { short = false } = {}) {
  const key = cleanIntens(ex?.intens), p = INTENS_PLANS[key];
  if (!p) return '';
  const where = intensWhereOf(ex);
  if (!Array.isArray(where)) return short ? p.short : p.label;
  const t = TECHS[p.tech].label.toLowerCase();
  if (where.length === 1 && where[0] === 1) return short ? `1re en ${t}` : `Première série en ${t}`;
  const w = intensWhereText(where);
  return `${short ? w.charAt(0).toLowerCase() + w.slice(1) : w} en ${t}`;
}
// Technique de chacune des n séries de travail prescrite par le programme (null : aucune) : la dernière, toutes, les
// séries choisies (intensOn), ou top set puis back-off. Sert au démarrage de la séance et à l'écran du coach
function intensPlanTechs(plan, on, n) {
  const p = INTENS_PLANS[cleanIntens(plan)], len = Math.max(0, parseInt(n) || 0);
  if (!p) return Array(len).fill(null);
  if (p.on === 'first') return Array.from({ length: len }, (_, i) => i === 0 ? 'top' : 'backoff');
  if (p.on === 'all') return Array(len).fill(p.tech);
  const sets = cleanIntensOn(on, plan)?.sets;
  return Array.from({ length: len }, (_, i) => (sets ? sets.includes(i + 1) : i === len - 1) ? p.tech : null);
}

// ── Séance en cours ──────────────────────────────────────────
// Charge proposée (kg stockés, texte) pour la sous-série k de s, tant que la personne n'y a pas touché :
// la même pour un rest-pause ou un cluster ; pour un drop set, celle de la dernière fois si elle est plus
// légère que la charge d'avant (la série pour k = 0, le drop précédent sinon), sinon cette charge allégée
// de 20 % et arrondie au matériel (round : unité affichée → unité affichée). Machine d'assistance : la même
// aide (alléger voudrait dire plus d'aide, à régler soi-même). '' sans charge.
function subAutoKg(s, k, { round = v => v, assisted = false } = {}) {
  const t = setTech(s);
  if (!techHasSub(t)) return '';
  const base = k === 0 ? s.weight : subWeightKg(s, k - 1, { round, assisted });
  const v = toUnitW(base);
  if (!(v > 0)) return '';
  if (TECHS[t].ratio === 1 || assisted) return storeW(String(v));
  // La dernière fois, plus léger que la charge d'avant : repris (même charge que d'habitude) ; plus lourd
  // ou égal (la série a baissé depuis) : ce ne serait plus un drop, la règle des 20 % reprend
  const p = toUnitW(s.sub?.[k]?.prev?.weight);
  if (p > 0 && p < v) return storeW(String(p));
  let w = Math.round(round(v * TECHS[t].ratio) * 100) / 100;
  if (!(w < v)) w = v;   // arrondi au matériel : jamais plus lourd que la charge d'avant
  return storeW(String(w));
}
// Charge d'une sous-série (kg stockés) : saisie, sinon proposée (subAutoKg)
function subWeightKg(s, k, opts = {}) {
  const x = s?.sub?.[k];
  if (!x) return '';
  return x.auto ? subAutoKg(s, k, opts) : (x.weight ?? '');
}
// Nouvelle sous-série k de s, charge proposée (auto) ; la même la dernière fois (même technique sur la série
// de même rang) donne l'objectif de reps et la charge habituelle d'un drop (subAutoKg)
function newSubSet(s, k) {
  const p = s?.prev && s.prev.tech === s.tech && Array.isArray(s.prev.sub) ? cleanSubSet(s.prev.sub[k]) : null;
  return { weight: '', reps: '', done: false, auto: true, prev: p };
}
// Pose la technique t sur la série s (séance en cours) ; t null la retire. Même technique : rien ne change.
// Série notée par bras (js/data/unilateral.js) : le second côté a autant de sous-séries (la technique retirée, il reste :
// l'exercice reste noté par bras, « Noter les deux bras ensemble » le rassemble)
function applyTech(s, t) {
  if (!s || s.warmup) return false;
  if (t && (!Object.hasOwn(TECHS, t) || s.tech === t)) return false;
  const had = !!s.tech;
  if (!t) { delete s.tech; delete s.sub; } else {
    s.tech = t;
    if (techHasSub(t)) s.sub = [newSubSet(s, 0)]; else delete s.sub;
  }
  syncSide2Subs(s);
  return t ? true : had;
}
// Sous-série de plus (bouton « + drop ») ; false au maximum
function addSubSet(s) {
  if (!techHasSub(setTech(s))) return false;
  s.sub ||= [];
  if (s.sub.length >= TECH_SUB_MAX) return false;
  s.sub.push(newSubSet(s, s.sub.length));
  syncSide2Subs(s);
  return true;
}
// Prescription du programme posée sur les séries d'un exercice de la séance qui commence : sur la dernière série de
// travail, sur toutes, sur les séries choisies (on : intensOn de l'exercice du programme), ou top set sur la première
// et back-off sur les suivantes (intensPlanTechs). Une série choisie qui n'existe pas dans la séance : rien.
// Séries déjà faites ou portant déjà une technique : laissées telles quelles.
function applyIntensPlan(ex, plan, on = null) {
  if (!cleanIntens(plan) || !ex || !canTech(ex)) return 0;
  const work = (ex.sets || []).filter(s => !isWarmupSet(s));
  const techs = intensPlanTechs(plan, on, work.length);
  let n = 0;
  work.forEach((s, i) => { const t = techs[i]; if (t && !s.done && !s.tech && applyTech(s, t)) { techSides(ex, s); n++; } });
  return n;
}
// Exercice unilatéral (js/data/unilateral.js) : une technique à sous-séries fait passer tout l'exercice par bras, le
// drop set existe de chaque côté (demande de Maxence du 19/11 : « bras gauche lourd, allégé, puis bras droit » ; panel du
// 20/11 : toutes les séries, les validées comprises, pas la seule série du drop). Renvoie le nombre de séries changées.
function techSides(ex, s) {
  return unilateralLimb(ex) && techHasSub(setTech(s)) ? exSides(ex) : 0;
}
// Back-off pré-rempli plus léger que le top set (panel du 16/11 : « Back-off allégée » à la même charge que le top set).
// Règle annoncée (docs/INTENSIFICATION.md) : charge du top set − 10 %, arrondie à ce qui se charge (barre et disques,
// sinon pas de 2,5 kg ou 5 lb : roundLoad, js/data/plates.js). Une série de back-off déjà plus légère (celle de la
// dernière fois) garde sa charge ; une charge prescrite par le coach passe après (prescPrefill). Renvoie le nombre de
// séries changées.
const BACKOFF_RATIO = 0.9;
function backoffPrefill(ex) {
  if (!ex || !canTech(ex)) return 0;
  const work = (ex.sets || []).filter(s => !isWarmupSet(s));
  const top = work.find(s => setTech(s) === 'top');
  const tw = toUnitW(top?.weight);
  if (!(tw > 0)) return 0;
  const b = roundLoad(tw * BACKOFF_RATIO, { ...plateSetup(), barbell: isBarbellExercise(ex) });
  if (!(b < tw)) return 0;
  let n = 0;
  work.forEach(s => {
    if (s.done || setTech(s) !== 'backoff') return;
    const w = toUnitW(s.weight);
    if (w > 0 && w < tw) return;
    s.weight = storeW(String(b));
    s.plannedWeight = s.weight;
    n++;
  });
  return n;
}
// Choix du menu ⋯ d'un exercice de la séance (js/features/session-sheets.js) : une seule entrée, toute technique
// sur une série. « Dernière série en drop set » faisait doublon (panel du 06/11 : une action, un sens) ; le chemin
// court reste le numéro de la série (2 touchers)
function techMenuActions(ex) {
  if (!canTech(ex)) return [];
  return [{ label: 'Technique d\'intensification…', value: 'tech-pick' }];
}
// Après une validation dans la série s : secondes de pause avant l'étape qui suit (setNextStep, js/data/unilateral.js :
// sous-série, ou second côté d'une série notée par bras), 0 pour enchaîner sans repos (un drop, l'autre côté), ou
// null quand la série est finie (repos habituel)
function techPauseAfter(s) {
  const n = s && setNextStep(s.done ? s : { ...s, done: true });   // appelé juste après la validation de la série
  if (!n) return null;
  return n.k < 0 ? 0 : TECHS[setTech(s)].pause;
}

// Étape à faire maintenant dans la série qu'on vient de valider (last : activeSession.lastDone, { ei, si }) : une
// sous-série, ou le second côté d'une série notée par bras (setNextStep) ; { ei, si, k, side } (k : -1 pour la ligne
// du second côté), null sinon. Une sous-série sautée (une autre série validée depuis) n'est plus « à faire » : elle
// reste à remplir, mais ni la carte ni l'écran ne s'y arrêtent.
function techCurrentSub(xs, last) {
  const s = last ? xs?.[last.ei]?.sets?.[last.si] : null;
  const n = setNextStep(s);
  return n ? { ei: last.ei, si: last.si, k: n.k, side: n.side } : null;
}
// L'exercice ei attend sa sous-série en cours (sa carte ne se replie pas)
function techPending(xs, last, ei) { return techCurrentSub(xs, last)?.ei === ei; }

// ── Textes ───────────────────────────────────────────────────
// « 46 kg × 5 · 40 kg × 4 » : sous-séries d'une série (kind : loadKind de l'exercice)
function subSetsText(s, kind = 'charge') {
  return subSetsOf(s).map(x => measureSetTxt(x, 'reps', kind)).join(' · ');
}
// Lignes de l'historique sous les séries d'un exercice : « Drop set série 3 : 46 kg × 5 · 40 kg × 4 »,
// « Top set série 1 · Back-off séries 2, 3 » (étiquettes regroupées). [] sans technique. « Série » en toutes lettres,
// plus « S3 » (grille avant panel du 19/11, règle 11 : pas d'abréviation pour une débutante), comme en séance.
// ex (facultatif) : une série notée par bras dit son côté (« Drop set série 3, bras gauche : … ») ; le second côté suit
// dans sideLines (js/data/unilateral.js)
function techLines(sets, kind = 'charge', ex = null) {
  const work = workSets(sets), lines = [], labels = new Map();
  work.forEach((s, i) => {
    const t = setTech(s);
    if (!t) return;
    if (!techHasSub(t)) { if (!labels.has(t)) labels.set(t, []); labels.get(t).push(i + 1); return; }
    const txt = subSetsText(s, kind);
    if (txt) lines.push(`${TECHS[t].label} série ${i + 1}${ex && hasSide2(s) ? `, ${sideName(ex, 1).toLowerCase()}` : ''} : ${txt}`);
  });
  const tags = [...labels.entries()].map(([t, ns]) => `${TECHS[t].label} ${ns.length > 1 ? 'séries' : 'série'} ${ns.join(', ')}`).join(' · ');
  return tags ? [tags, ...lines] : lines;
}
// Fin du détail des séries de l'image partagée : « drop set 46 kg × 5 · 40 kg × 4 » (deux au plus), ''
function techShareText(sets, kind = 'charge') {
  return workSets(sets).filter(s => techHasSub(setTech(s)) && subSetsOf(s).length).slice(0, 2)
    .map(s => `${TECHS[setTech(s)].label.toLowerCase()} ${subSetsText(s, kind)}`).join(', ');
}
