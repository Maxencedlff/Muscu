// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : dictionnaire appris du coach.
//  Chaque correction faite à l'écran « Vérifier l'import » (« DC inc » = Développé incliné barre) est retenue dans
//  data.planAliases { clé : nom }, synchronisé avec le compte (SYNC_PROFILE_KEYS, fusion par union) : le prochain
//  import la reconnaît d'office, sur tous ses appareils. La clé ne garde que les mots (ordre, accents, pluriels et
//  abréviations ignorés), le nom est celui de la fiche ou celui que le coach a écrit.
//  Mise en commun (préparée, pas branchée) : planAliasesSharePayload, docs/IMPORT_PROGRAMME.md « Notre propre IA ».
//  Logique pure, sans écran.
// ═══════════════════════════════════════════════════════════
'use strict';

const PARSE_ALIASES_MAX = 600;          // corrections gardées (les plus anciennes partent d'abord)
const PARSE_ALIAS_KEY_MAX = 80, PARSE_ALIAS_NAME_MAX = 80;

// Clé d'un nom lu : mots de recherche (planMatchKey, js/data/plan-match.js) triés ; null si vide ou trop long
function planAliasKey(raw) {
  const k = planWords(planMatchKey(raw)).sort().join(' ');
  return k && k.length <= PARSE_ALIAS_KEY_MAX ? k : null;
}
function planLearnedAliases(d = data) { return d?.planAliases && typeof d.planAliases === 'object' ? d.planAliases : {}; }

// Retient « brut = nom » ; renvoie true si le dictionnaire a changé. Rien n'est retenu quand la bibliothèque le
// reconnaît déjà de la même façon (le dictionnaire ne garde que ce qu'elle ignore)
function planLearnAlias(raw, name, d = data) {
  const key = planAliasKey(raw), nm = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, PARSE_ALIAS_NAME_MAX);
  if (!key || !nm) return false;
  const known = planMatchExercise(raw);
  if (known.score >= 0.95 && known.name === nm && !d.planAliases?.[key]) return false;
  const map = { ...(d.planAliases || {}) };
  if (map[key] === nm) return false;
  delete map[key];
  map[key] = nm;
  const keys = Object.keys(map);
  keys.slice(0, Math.max(0, keys.length - PARSE_ALIASES_MAX)).forEach(k => delete map[k]);
  d.planAliases = map;
  return true;
}
function planForgetAlias(raw, d = data) {
  const key = planAliasKey(raw);
  if (!key || !d.planAliases?.[key]) return false;
  delete d.planAliases[key];
  if (!Object.keys(d.planAliases).length) delete d.planAliases;
  return true;
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
