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
  rp:      { label: 'Rest-pause', short: 'RP', sub: true,  subName: 'reprise', fem: true, ratio: 1,  pause: 15, hint: 'pause 15 s' },
  cluster: { label: 'Cluster',    short: 'C',  sub: true,  subName: 'bloc',   ratio: 1,  pause: 20, hint: 'pause 20 s' },
  top:     { label: 'Top set',    short: 'T',  sub: false, hint: 'la plus lourde' },
  backoff: { label: 'Back-off',   short: 'B',  sub: false, hint: 'allégée' },
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
// Séries du volume : séries de travail suivies de leurs sous-séries (l'échauffement n'y est jamais)
function volumeSets(sets) { return workSets(sets).flatMap(s => [s, ...subSetsOf(s)]); }
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
  topback:        { tech: 'top',     on: 'first', label: '1re série top set, puis back-off', short: 'top set puis back-off' },
};
function cleanIntens(v) { return typeof v === 'string' && Object.hasOwn(INTENS_PLANS, v) ? v : null; }
function intensLabel(v) { return INTENS_PLANS[cleanIntens(v)]?.label || ''; }

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
function applyTech(s, t) {
  if (!s || s.warmup) return false;
  if (!t) { const had = !!s.tech; delete s.tech; delete s.sub; return had; }
  if (!Object.hasOwn(TECHS, t) || s.tech === t) return false;
  s.tech = t;
  if (techHasSub(t)) s.sub = [newSubSet(s, 0)]; else delete s.sub;
  return true;
}
// Sous-série de plus (bouton « + drop ») ; false au maximum
function addSubSet(s) {
  if (!techHasSub(setTech(s))) return false;
  s.sub ||= [];
  if (s.sub.length >= TECH_SUB_MAX) return false;
  s.sub.push(newSubSet(s, s.sub.length));
  return true;
}
// Prescription du programme posée sur les séries d'un exercice de la séance qui commence : sur la
// dernière série de travail, sur toutes, ou top set sur la première et back-off sur les suivantes.
// Séries déjà faites ou portant déjà une technique : laissées telles quelles.
function applyIntensPlan(ex, plan) {
  const p = INTENS_PLANS[cleanIntens(plan)];
  if (!p || !ex || !canTech(ex)) return 0;
  const work = (ex.sets || []).filter(s => !isWarmupSet(s));
  if (!work.length) return 0;
  const pairs = p.on === 'last' ? [[work.at(-1), p.tech]]
    : p.on === 'all' ? work.map(s => [s, p.tech])
    : work.map((s, i) => [s, i === 0 ? 'top' : 'backoff']);
  let n = 0;
  for (const [s, t] of pairs) if (!s.done && !s.tech && applyTech(s, t)) n++;
  return n;
}
// Choix du menu ⋯ d'un exercice de la séance (js/features/session-sheets.js) : une seule entrée, toute technique
// sur une série. « Dernière série en drop set » faisait doublon (panel du 06/11 : une action, un sens) ; le chemin
// court reste le numéro de la série (2 touchers)
function techMenuActions(ex) {
  if (!canTech(ex)) return [];
  return [{ label: 'Technique d\'intensification…', value: 'tech-pick' }];
}
// Après la validation de la série s : secondes de pause avant sa première sous-série (0 : enchaîner
// sans repos), ou null s'il n'y a pas de sous-série à faire (repos habituel)
function techPauseAfter(s) {
  const t = setTech(s);
  if (!techHasSub(t) || !(s.sub || []).some(x => !x.done)) return null;
  return TECHS[t].pause;
}

// Sous-série à faire maintenant : celle de la série qu'on vient de valider (last : activeSession.lastDone,
// { ei, si }), la première non faite ; null sinon. Une sous-série sautée (une autre série validée depuis)
// n'est plus « à faire » : elle reste à remplir, mais ni la carte ni l'écran ne s'y arrêtent.
function techCurrentSub(xs, last) {
  const s = last ? xs?.[last.ei]?.sets?.[last.si] : null;
  if (!s?.done || !techHasSub(setTech(s))) return null;
  const k = (s.sub || []).findIndex(x => !x.done);
  return k >= 0 ? { ei: last.ei, si: last.si, k } : null;
}
// L'exercice ei attend sa sous-série en cours (sa carte ne se replie pas)
function techPending(xs, last, ei) { return techCurrentSub(xs, last)?.ei === ei; }

// ── Textes ───────────────────────────────────────────────────
// « 46 kg × 5 · 40 kg × 4 » : sous-séries d'une série (kind : loadKind de l'exercice)
function subSetsText(s, kind = 'charge') {
  return subSetsOf(s).map(x => measureSetTxt(x, 'reps', kind)).join(' · ');
}
// Lignes de l'historique sous les séries d'un exercice : « Drop set S3 : 46 kg × 5 · 40 kg × 4 »,
// « Top set S1 · Back-off S2, S3 » (étiquettes regroupées). [] sans technique.
function techLines(sets, kind = 'charge') {
  const work = workSets(sets), lines = [], labels = new Map();
  work.forEach((s, i) => {
    const t = setTech(s);
    if (!t) return;
    if (!techHasSub(t)) { if (!labels.has(t)) labels.set(t, []); labels.get(t).push(`S${i + 1}`); return; }
    const txt = subSetsText(s, kind);
    if (txt) lines.push(`${TECHS[t].label} S${i + 1} : ${txt}`);
  });
  const tags = [...labels.entries()].map(([t, ns]) => `${TECHS[t].label} ${ns.join(', ')}`).join(' · ');
  return tags ? [tags, ...lines] : lines;
}
// Fin du détail des séries de l'image partagée : « drop set 46 kg × 5 · 40 kg × 4 » (deux au plus), ''
function techShareText(sets, kind = 'charge') {
  return workSets(sets).filter(s => techHasSub(setTech(s)) && subSetsOf(s).length).slice(0, 2)
    .map(s => `${TECHS[setTech(s)].label.toLowerCase()} ${subSetsText(s, kind)}`).join(', ');
}
