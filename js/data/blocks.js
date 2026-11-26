// ═══════════════════════════════════════════════════════════
//  Blocs d'exercice : le même exercice plusieurs fois dans une séance, et le rôle de chaque bloc
//  (retour d'un testeur du 26/11 : 2 séries d'Extension quadriceps en pré-fatigue au début, les vraies séries à la fin)
//
//  Un bloc = une place d'un exercice dans une séance (programme, séance en cours, historique).
//  - Suivi commun : tous les blocs d'un exercice partagent son identifiant de suivi (exIdOf, js/core/util.js), donc
//    un seul historique, une seule courbe, les mêmes records. Au programme, le 1er bloc porte cet identifiant dans
//    `id` ; un bloc de plus garde un `id` à lui (réglages, consigne et charge du coach, écrans) et pointe le suivi
//    par `exId`. Séance en cours et historique : `exId` = le suivi, comme avant.
//  - Rang stable `occ` (2, 3… ; absent = 1) : écrit à la création du bloc, jamais renuméroté (déplacer ou retirer
//    un bloc ne change pas le rang des autres). Il relie un bloc à SA dernière fois : la colonne « Avant » du bloc
//    de pré-fatigue reprend la pré-fatigue, pas les séries lourdes (lastPerf, js/data/store.js).
//  - Rôle `role` : 'prefat' (Pré-fatigue) ou 'warmup' (Échauffement), absent = Normal. Ses séries portent
//    warmup: true, le marquage de l'échauffement (js/data/warmup.js) : hors volume, records, 1RM estimé, « À battre »,
//    courbes et séries par muscle, partout où l'échauffement l'est déjà, y compris chez un ami ou un coach (le
//    serveur transmet warmup, private.session_public) et dans une version précédente de l'app.
//  Compatibilité : champs additifs (une version précédente les garde sans les lire : cleanHistoryEntry et
//  sanitizeData ne retirent pas les champs inconnus). Une version précédente qui fait une séance d'un programme à
//  blocs écrit exId = id du bloc : relinkBlockHistory rattache ces exercices au suivi commun.
// ═══════════════════════════════════════════════════════════
'use strict';

const BLOCK_ROLES = { prefat: 'Pré-fatigue', warmup: 'Échauffement' };
// Phrase des écrans de choix du rôle (app et site du coach)
const BLOCK_ROLE_HELP = 'Pré-fatigue et échauffement ne comptent ni dans les records, ni dans le volume, ni dans les séries par muscle.';
const BLOCK_OCC_MAX = 20;
const BLOCK_EXID_MAX = 120;   // identifiant de suivi : uid, ou « n: » + nom normalisé (nameKey)

function blockRole(e) { return typeof e?.role === 'string' && Object.hasOwn(BLOCK_ROLES, e.role) ? e.role : null; }
function blockRoleLabel(e) { const r = blockRole(e); return r ? BLOCK_ROLES[r] : 'Normal'; }
function occOf(e) { const n = e?.occ; return Number.isInteger(n) && n >= 2 && n <= BLOCK_OCC_MAX ? n : 1; }
// Même bloc : même exercice (sameEx) et même rang
function sameBlock(a, b) { return sameEx(a, b) && occOf(a) === occOf(b); }
// Clé d'un bloc, la même au programme, dans la séance et dans l'historique : « suivi#rang » (ordre de la séance gardé
// au programme, « Garder cet ordre »)
function blockKey(e) { return `${exIdOf(e) || nameKey(e?.name)}#${occOf(e)}`; }
// Même exercice dans une liste de blocs : par le suivi si les deux en ont un, sinon par le nom (renommages de la
// bibliothèque compris : exercice choisi par son seul nom)
function sameExercise(a, b) {
  const ia = exIdOf(a), ib = exIdOf(b);
  return ia && ib ? ia === ib : sameExerciseName(a?.name, b?.name);
}

// Champs de bloc nettoyés (sanitizeData, cleanHistoryEntry, programme reçu d'un coach) : rang et rôle valides ou
// absents ; au programme (prog), suivi d'un bloc de plus : un texte court différent de son id
function cleanBlockFields(e, prog = false) {
  if (!e || typeof e !== 'object') return e;
  if (e.occ !== undefined && occOf(e) === 1) delete e.occ;
  if (e.role !== undefined && !blockRole(e)) delete e.role;
  if (prog && e.exId !== undefined && !(typeof e.exId === 'string' && e.exId && e.exId.length <= BLOCK_EXID_MAX && e.exId !== e.id)) delete e.exId;
  return e;
}

// Rang du prochain bloc de exLike dans xs : 1 s'il n'y est pas, sinon le plus grand rang + 1 (jamais celui d'un
// bloc encore là)
function nextOcc(xs, exLike) {
  const same = (xs || []).filter(e => e && sameExercise(e, exLike));
  return same.length ? Math.min(BLOCK_OCC_MAX, Math.max(...same.map(occOf)) + 1) : 1;
}

// Nom affiché d'un bloc dans sa liste xs : « Extension quadriceps · 2 » pour le 2e bloc du même exercice en lisant
// de haut en bas, le nom seul pour le premier ou un exercice présent une fois
function blockName(ex, xs) {
  const name = String(ex?.name ?? '');
  const same = (xs || []).filter(e => e && sameExercise(e, ex));
  const i = same.indexOf(ex);
  return same.length > 1 && i > 0 ? `${name} · ${i + 1}` : name;
}

// Nouveau bloc ex de la liste xs du programme : si l'exercice y est déjà, même suivi (exId = celui du premier bloc)
// et rang suivant. Sans effet sinon. Renvoie ex.
function linkBlock(xs, ex) {
  const first = (xs || []).find(e => e && e !== ex && sameExerciseName(e.name, ex.name));
  if (!first) return ex;
  const track = exIdOf(first);
  if (track && track !== ex.id) ex.exId = track;
  const o = nextOcc((xs || []).filter(e => e !== ex), first);
  if (o > 1) ex.occ = o;
  return ex;
}

// Rôle d'un bloc de la séance (ou d'une séance passée) : Pré-fatigue et Échauffement marquent toutes ses séries
// warmup: true, Normal les rend toutes de travail (une série d'échauffement ajoutée par la feuille redevient de travail)
function setBlockRole(ex, role) {
  if (Object.hasOwn(BLOCK_ROLES, role)) ex.role = role; else delete ex.role;
  (ex.sets || []).forEach(s => { if (!s || typeof s !== 'object') return; if (ex.role) s.warmup = true; else delete s.warmup; });
  return ex;
}

// Champs de bloc copiés d'un bloc du programme vers la séance en cours ou l'historique
function blockFields(e) {
  return { ...(occOf(e) > 1 ? { occ: occOf(e) } : {}), ...(blockRole(e) ? { role: blockRole(e) } : {}) };
}

// Séries d'une fois précédente (prevEx) qui servent d'« Avant » : toutes s'il avait un rôle (elles sont toutes
// marquées échauffement), sinon ses séries de travail
function blockPrevSets(prevEx) {
  return blockRole(prevEx) ? (prevEx?.sets || []).slice() : workSets(prevEx?.sets);
}

// Une série se montre comme un échauffement (« É », « Échauffement 1 ») : marquée, hors bloc de pré-fatigue (ses
// séries gardent leur numéro : « Série 1 », « Série 2 »)
function warmLook(ex, s) { return isWarmupSet(s) && blockRole(ex) !== 'prefat'; }
// Numéro affiché d'une série : celui du bloc de pré-fatigue (toutes ses séries comptent), sinon setDisplayNo
function blockSetNo(ex, si) { return blockRole(ex) === 'prefat' ? si + 1 : setDisplayNo(ex?.sets, si); }

// Séries de tous les blocs du même exercice que ex dans xs (même mesure), dans l'ordre : records en direct et records
// notés sur l'exercice entier, jamais deux fois le même record dans une séance
function exerciseSetsAcross(xs, ex) {
  const m = measureOf(ex);
  const same = (xs || []).filter(e => e && sameExercise(e, ex) && measureOf(e) === m);
  return same.length > 1 ? same.flatMap(e => e.sets || []) : (ex?.sets || []);
}
// Exercices d'une séance regroupés par exercice (premier bloc, séries de tous ses blocs de même mesure)
function exerciseGroups(xs) {
  const out = [];
  (xs || []).forEach(e => {
    if (!e) return;
    const g = out.find(o => sameExercise(o.ex, e) && measureOf(o.ex) === measureOf(e));
    if (g) g.ex = { ...g.ex, sets: [...g.ex.sets, ...(e.sets || [])] };
    else out.push({ ex: { ...e, sets: [...(e.sets || [])] }, first: e });
  });
  return out;
}

// Séances notées par une version d'avant les blocs depuis un programme qui en a : leur exercice porte l'id du bloc
// (exId = id). Rattaché au suivi commun, avec le rang et le rôle du bloc (séries marquées). Idempotent ; renvoie le
// nombre d'exercices corrigés (0 : rien n'a changé). xs : listes d'exercices à corriger (historique par défaut).
function relinkBlockHistory(d, lists = null) {
  const map = new Map();
  Object.values(d?.programmes || {}).forEach(p => Object.values(p?.exercises || {}).forEach(xs => (Array.isArray(xs) ? xs : [])
    .forEach(e => { if (e && typeof e.exId === 'string' && e.exId && e.exId !== e.id && typeof e.id === 'string') map.set(e.id, e); })));
  if (!map.size) return 0;
  let n = 0;
  (lists || (d.history || []).map(h => h?.exercises)).forEach(xs => (Array.isArray(xs) ? xs : []).forEach(x => {
    const b = x && map.get(x.exId);
    if (!b) return;
    x.exId = b.exId;
    if (occOf(b) > 1 && x.occ === undefined) x.occ = occOf(b);
    if (blockRole(b) && !blockRole(x) && !(x.sets || []).some(isWarmupSet)) setBlockRole(x, blockRole(b));
    n++;
  }));
  return n;
}
