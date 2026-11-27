// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : dictionnaire appris du coach.
//  Chaque correction faite à l'écran « Vérifier l'import » (« DC inc » = Développé incliné barre) est retenue dans
//  data.planAliases { clé : nom } (dates et corrections oubliées dans data.planAliasesAt), synchronisé avec le compte
//  (SYNC_PROFILE_KEYS, fusion datée clé par clé, mergePlanAliases) : le prochain
//  import la reconnaît d'office, sur tous ses appareils. La clé ne garde que les mots (ordre, accents, pluriels et
//  abréviations ignorés), le nom est celui de la fiche ou celui que le coach a écrit.
//  Mise en commun (préparée, pas branchée) : planAliasesSharePayload, docs/IMPORT_PROGRAMME.md « Notre propre IA ».
//  Logique pure, sans écran. Chargé avant store.js (sanitizeData nettoie le dictionnaire dès le lancement) ; planWords et
//  planMatchKey (plan-match.js, chargé après) ne servent qu'à l'appel.
// ═══════════════════════════════════════════════════════════
'use strict';

const PARSE_ALIASES_MAX = 600;          // corrections gardées (les plus anciennes partent d'abord)
const PARSE_ALIASES_GONE_MAX = 600;     // corrections oubliées gardées comme pierres tombales (les plus anciennes partent)
const PARSE_ALIAS_KEY_MAX = 80, PARSE_ALIAS_NAME_MAX = 80;
const planOwn = (o, k) => !!o && typeof o === 'object' && Object.hasOwn(o, k);
const planIsMap = o => !!o && typeof o === 'object' && !Array.isArray(o);

// Clé d'un nom lu : mots de recherche (planMatchKey, js/data/plan-match.js) triés ; null si vide ou trop long
function planAliasKey(raw) {
  const k = planWords(planMatchKey(raw)).sort().join(' ');
  return k && k.length <= PARSE_ALIAS_KEY_MAX && k !== '__proto__' ? k : null;
}
function planLearnedAliases(d = data) { return planIsMap(d?.planAliases) ? d.planAliases : {}; }

// Dates : data.planAliasesAt { clé : ms } pour chaque correction, ET pour chaque correction oubliée (clé absente de
// planAliases : pierre tombale). La fusion de la synchro garde, clé par clé, le plus récent des deux appareils : une
// correction oubliée ici ne revient pas d'un appareil qui l'a encore (mergePlanAliases)
// Nettoyage commun (enregistrement, sanitizeData, fusion) : noms valides, puis les plus anciennes sortent
function planAliasesTidy(map, at) {
  const live = [], gone = [];
  const stamp = k => (planOwn(at, k) && Number.isFinite(at[k]) && at[k] > 0 ? Math.round(at[k]) : 0);
  const okKey = k => k && k.length <= PARSE_ALIAS_KEY_MAX && k !== '__proto__';
  if (planIsMap(map)) Object.keys(map).forEach((k, i) => {
    const v = map[k];
    if (okKey(k) && typeof v === 'string' && v.trim() && v.length <= PARSE_ALIAS_NAME_MAX) live.push({ k, v, t: stamp(k), i });
  });
  const liveKeys = new Set(live.map(x => x.k));
  if (planIsMap(at)) Object.keys(at).forEach((k, i) => { if (okKey(k) && !liveKeys.has(k) && stamp(k) > 0) gone.push({ k, t: stamp(k), i }); });
  // Plus récente d'abord ; à date égale (données sans date), l'ordre d'insertion : la dernière ajoutée reste
  const recent = (a, b) => b.t - a.t || b.i - a.i;
  const keepLive = live.sort(recent).slice(0, PARSE_ALIASES_MAX).reverse();
  const keepGone = gone.sort(recent).slice(0, PARSE_ALIASES_GONE_MAX).reverse();
  const out = { map: {}, at: {} };
  keepLive.forEach(x => { out.map[x.k] = x.v; if (x.t) out.at[x.k] = x.t; });
  keepGone.forEach(x => { out.at[x.k] = x.t; });
  return out;
}
function planAliasesStore(d, r) {
  if (Object.keys(r.map).length) d.planAliases = r.map; else delete d.planAliases;
  if (Object.keys(r.at).length) d.planAliasesAt = r.at; else delete d.planAliasesAt;
}
// sanitizeData (js/data/store.js) : même règle que l'enregistrement
function planAliasesSanitize(d) {
  if (d.planAliases === undefined && d.planAliasesAt === undefined) return;
  planAliasesStore(d, planAliasesTidy(d.planAliases, d.planAliasesAt));
}

// Retient « brut = nom » ; renvoie true si le dictionnaire a changé. Rien n'est retenu quand la bibliothèque le
// reconnaît déjà de la même façon (le dictionnaire ne garde que ce qu'elle ignore)
function planLearnAlias(raw, name, d = data, now = Date.now()) {
  const key = planAliasKey(raw), nm = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, PARSE_ALIAS_NAME_MAX);
  if (!key || !nm) return false;
  const cur = planLearnedAliases(d);
  const has = planOwn(cur, key) && typeof cur[key] === 'string';
  const known = planMatchExercise(raw);
  if (known.score >= 0.95 && known.name === nm && !has) return false;
  if (has && cur[key] === nm) return false;
  const map = { ...cur }, at = planIsMap(d.planAliasesAt) ? { ...d.planAliasesAt } : {};
  delete map[key];
  map[key] = nm;
  at[key] = now;
  planAliasesStore(d, planAliasesTidy(map, at));
  return true;
}
// Oublie une correction (par sa clé, ou par le nom lu) : pierre tombale datée, pour que la synchro ne la ramène pas
function planForgetAliasKey(key, d = data, now = Date.now()) {
  const cur = planLearnedAliases(d);
  if (!key || !planOwn(cur, key)) return false;
  const map = { ...cur }, at = planIsMap(d.planAliasesAt) ? { ...d.planAliasesAt } : {};
  delete map[key];
  at[key] = now;
  planAliasesStore(d, planAliasesTidy(map, at));
  return true;
}
function planForgetAlias(raw, d = data, now = Date.now()) { return planForgetAliasKey(planAliasKey(raw), d, now); }
// Toutes les corrections retenues, les plus récentes d'abord (Réglages › Corrections retenues)
function planAliasesList(d = data) {
  const map = planLearnedAliases(d), at = planIsMap(d?.planAliasesAt) ? d.planAliasesAt : {};
  return Object.keys(map).filter(k => typeof map[k] === 'string')
    .map((k, i) => ({ key: k, name: map[k], at: planOwn(at, k) && Number.isFinite(at[k]) ? at[k] : 0, i }))
    .sort((a, b) => b.at - a.at || b.i - a.i).map(({ key, name, at: t }) => ({ key, name, at: t }));
}
// Fusion de la synchro (js/data/sync.js, mergeChoiceProfile) : clé par clé, la date la plus récente gagne
// (correction, ou pierre tombale) ; une entrée sans date (0) perd contre une entrée datée. À égalité : cet appareil
function mergePlanAliases(local, remote) {
  const lm = planIsMap(local?.planAliases) ? local.planAliases : {}, la = planIsMap(local?.planAliasesAt) ? local.planAliasesAt : {};
  const rm = planIsMap(remote?.planAliases) ? remote.planAliases : {}, ra = planIsMap(remote?.planAliasesAt) ? remote.planAliasesAt : {};
  const t = (a, k) => (planOwn(a, k) && Number.isFinite(a[k]) ? a[k] : 0);
  const map = {}, at = {};
  const keys = new Set([...Object.keys(lm), ...Object.keys(la), ...Object.keys(rm), ...Object.keys(ra)]);
  for (const k of keys) {
    const lHas = planOwn(lm, k) && typeof lm[k] === 'string', rHas = planOwn(rm, k) && typeof rm[k] === 'string';
    const lt = t(la, k), rt = t(ra, k);
    if (!lHas && !rHas) { const g = Math.max(lt, rt); if (g) at[k] = g; continue; }
    const useRemote = rt > lt || (rt === lt && !lHas && rHas && rt === 0);
    const has = useRemote ? rHas : lHas, stamp = useRemote ? rt : lt;
    if (has) map[k] = useRemote ? rm[k] : lm[k];
    if (stamp) at[k] = stamp;
  }
  return planAliasesTidy(map, at);
}

// ── Mise en commun anonyme et volontaire (préparée, pas branchée) ──
// Ce qui partirait si le coach l'acceptait : seulement des paires « mots → fiche de la bibliothèque » (jamais un nom
// d'exercice inventé, qui peut contenir un prénom), courtes (5 mots au plus), sans nombre de plus de deux chiffres
// (téléphone, date), sans identifiant ni compte. Le serveur ne garderait une paire que proposée par au moins 3 comptes
// différents (docs/IMPORT_PROGRAMME.md).
function planAliasesSharePayload(d = data) {
  return Object.entries(planLearnedAliases(d))
    .filter(([k, n]) => k.split(' ').length <= 5 && k.length <= 40 && !/\d{3,}/.test(k) && catalogueEntry(n)?.name === n)
    .map(([k, n]) => ({ k, n }))
    .slice(0, 200);
}
