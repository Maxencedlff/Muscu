// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : reconnaissance du nom d'un exercice.
//  Nom de la bibliothèque, alias, abréviations de salle (DC, DM, SDT, RDL, OHP, HT, élév lat…), nom anglais des
//  apps (matchImportedExercise, js/data/import-csv.js), dictionnaire appris du coach (js/data/plan-aliases.js),
//  puis recherche approchée qui tolère les fautes, les mots collés et le bruit de la lecture d'une photo.
//  planMatchExercise(brut, appris) → { name, score de 0 à 1, how, raw } ; name null si rien n'est assez proche.
//  Logique pure, sans écran.
// ═══════════════════════════════════════════════════════════
'use strict';

// Abréviations et formes courtes des plans de coachs, développées avant la recherche (en plus de ruleKey, muscles.js)
const PARSE_ABBREV = [
  [/\bohp\b/g, 'developpe militaire barre'], [/\brdl\b/g, 'souleve de terre roumain'], [/\bsldl\b/g, 'souleve de terre roumain'],
  [/\bht\b/g, 'hip thrust'], [/\bhip thrusts?\b/g, 'hip thrust'],
  [/\bsdt\s*jt\b|\bsdtjt\b/g, 'souleve de terre jambes tendues'], [/\bdl\b/g, 'souleve de terre'], [/\bdd\b/g, 'developpe decline'],
  [/\belev(?:ations?|\.)?\s*lat(?:erales?|eral|\.)?(?=\s|$)/g, 'elevations laterales'], [/\belev(?:ations?|\.)?\s*front(?:ales?|\.)?(?=\s|$)/g, 'elevations frontales'],
  [/\belev(?:ations?|\.)?\b/g, 'elevations'],
  [/\bleg ext\b/g, 'leg extension'], [/\bleg ext(?:ension)?s\b/g, 'leg extension'], [/\bext(?:ension)?s? quad(?:s|riceps)?\b/g, 'extension quadriceps'],
  [/\bhalt(?:e|er|ere|eres|\.)?(?=\s|$)/g, 'halteres'], [/\bhaltere\b/g, 'halteres'], [/\bdb\b/g, 'halteres'], [/\bbb\b/g, 'barre'],
  [/\binc(?:l|\.)?(?=\s|$)/g, 'incline'], [/\bdecl?(?=\s|$)/g, 'decline'], [/\bpdc\b/g, 'poids du corps'],
  [/\bunilat(?:eral|erale)?\b|\buni\b/g, 'unilateral'], [/\bsq\b/g, 'squat'], [/\btri\b/g, 'triceps'], [/\bbi\b/g, 'biceps'],
  [/\bmulti(?:power)?\b|\bmachine guidee\b/g, 'smith'], [/\bpoulie h(?:te|t|\.)?(?=\s|$)/g, 'poulie haute'], [/\bpoulie b(?:sse|s|\.)?(?=\s|$)/g, 'poulie basse'],
  [/\btirage poit(?:\.|rine)?(?=\s|$)/g, 'tirage poitrine'], [/\bt-?bar\b/g, 't bar'], [/\bez\b/g, 'ez'], [/\bisch(?:io|ios|\.)?(?=\s|$)/g, 'ischios'],
  [/\bpecs?\b/g, 'pec'], [/\bpushdowns?\b/g, 'pushdown'], [/\bdev(?:\.|elop|eloppe)?\s*epaules?\b/g, 'developpe epaules'],
  [/\bdc\s*serre\b/g, 'developpe couche serre'], [/\bcurls\b/g, 'curl'],
  // Homophones de la dictée (reconnaissance vocale d'iOS) : « lègue curl », « leg cœur l », « face poule », « squatte »
  [/\blegue\b/g, 'leg'], [/\b(?:coeur|cœur)\s*l\b|\bcoeurl\b/g, 'curl'], [/\bpoule\b/g, 'pull'], [/\bsquatte?s?\b/g, 'squat'],
  [/\broming\b/g, 'rowing'], [/\bdeveloppee?r?s?\b/g, 'developpe'], [/\bcoucher?s?\b/g, 'couche'], [/\bhips?\s+trust\b/g, 'hip thrust'],
  [/\bpresses?\s+a\s+cuisses?\b/g, 'presse a cuisses'], [/\btirages\b/g, 'tirage'],
];
// Formes courantes absentes des alias de la bibliothèque (la bibliothèque n'est pas modifiée) : mouvement seul → fiche de
// référence choisie par un coach (« Squat » = squat barre, « Tractions » = pronation), formes de salle et d'anglais
const PARSE_EXTRA_ALIASES = [
  ['Développé couché barre', 'developpe couche barre|couche barre|developpe couche classique|developpe allonge'],
  ['Développé couché haltères', 'developpe halteres|developpe couche halt'],
  ['Développé incliné haltères', 'incline halteres|developpe incline halteres|incline db'],
  ['Squat barre', 'squat|squats|squat libre|back squat barre|squat complet|squat arriere barre|high bar squat|low bar squat'],
  ['Tractions pronation', 'tractions|traction pronation|tractions larges|tractions lestees|tractions barre fixe|pullup|chin up pronation'],
  ['Rowing barre', 'rowing|rowing penche|rowing buste penche|rowing barre droite|barbell rows'],
  ['Tirage vertical prise large', 'tirage vertical|tirage haut|tirage devant|lat pull down|tirage poitrine prise large|tirage vertical large|tirage vertical poulie'],
  ['Tirage horizontal câble', 'tirage bas|rowing poulie|tirage horizontal assis|rowing assis poulie|tirage horizontal prise serree'],
  ['Mollets debout', 'mollets|extension mollets|extensions mollets|mollets machine|calf|calves|standing calf|mollets a la machine|mollets debout machine'],
  ['Crunch', 'abdos|crunchs|crunch abdos|abdominaux'],
  ['Gainage (planche)', 'gainage|gainage ventral|gainage frontal|planche abdos|gainage planche'],
  ['Extension triceps poulie haute', 'extension triceps|triceps corde|pushdown corde|extension triceps a la poulie|extensions triceps poulie|triceps a la poulie|poulie triceps'],
  ['Curl biceps haltères', 'curl|curl biceps|curl alterne|curl alterne halteres|curl biceps alterne|biceps halteres|curl halteres alterne'],
  ['Curl biceps barre', 'curl barre droite|curl biceps barre ez|curl a la barre'],
  ['Développé militaire haltères', 'developpe epaules|shoulder press|developpe assis halteres|developpe militaire assis'],
  ['Développé militaire barre', 'developpe militaire debout|military|developpe nuque|press militaire'],
  ['Élévations latérales', 'elevations laterales|lateral raises|elevation laterale|laterales|elevations'],
  ['Soulevé de terre roumain', 'souleve de terre roumain barre|sdt roumain|roumain'],
  ['Soulevé de terre', 'souleve de terre classique|deadlifts|souleve terre'],
  ['Leg curl machine', 'leg curl couche|ischios|leg curl ischios|curl ischio'],
  ['Extension quadriceps', 'leg extensions|extensions quadriceps|extensions'],
  ['Hip thrust', 'hip thrust barre|hips thrust|hip thrust a la barre|pousse de hanche'],
  ['Écarté poulie vis-à-vis', 'vis a vis|ecarte vis a vis|poulie vis a vis|ecarte poulie haute|cable crossovers'],
  ['Haussements d\'épaules haltères', 'shrugs|haussement epaules|haussements epaules|shrug halteres'],
  ['Presse à cuisses', 'presse inclinee|leg press 45|presse 45 degres|presse a cuisse'],
  ['Rowing haltère unilatéral', 'rowing haltere|rowing haltere un bras|one arm row|rowing unilateral haltere|rowing un bras haltere'],
  ['Oiseau (élévations arrière)', 'oiseau buste penche|rear delt|oiseau assis|oiseaux'],
  ['Kickback triceps', 'kickback|kick back|kickbacks'],
  ['Squat gobelet', 'goblet'],
  ['Fentes', 'fente|fentes avant|fentes alternees|fentes halteres|fentes statiques'],
  ['Développé décliné', 'developpe decline barre'],
  ['Écarté haltères plat', 'ecarte|ecartes|ecarte plat|ecartes couche|ecarte halteres couche'],
  ['Pompes', 'pompe|push ups'],
  ['Barre au front', 'skull crushers|barre front ez'],
];

// Mots qui ne disent rien du mouvement : retirés des deux côtés avant de comparer
const PARSE_STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'avec', 'en', 'sur', 'et', 'un', 'une',
  'the', 'with', 'on', 'of', 'exercice', 'exo']);

// Bruit de photo dans un mot : chiffres pris pour des lettres (« deve1oppé », « squ4t », « c0uché ») et « rn » lu pour « m »
function planOcrWord(w) {
  if (!/[a-z]/.test(w) || !/[0-9|]/.test(w) || /^\d+[a-z]{0,3}$/.test(w)) return w;
  return w.replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/5/g, 's').replace(/3/g, 'e').replace(/4/g, 'a').replace(/8/g, 'b').replace(/7/g, 't');
}
// Texte de recherche : clé de ruleKey (minuscules, sans accents, DC → développé couché), bruit corrigé, abréviations
// des plans développées, ponctuation ôtée
function planMatchKey(raw) {
  let k = ruleKey(String(raw ?? '').replace(/[|]/g, 'l')).replace(/[()[\]'’"*,;:!?+&]/g, ' ').replace(/\s+/g, ' ').trim();
  k = k.split(' ').map(planOcrWord).join(' ');
  for (const [re, full] of PARSE_ABBREV) k = k.replace(re, full);
  return k.replace(/\s+/g, ' ').trim();
}
const planWords = key => key.split(' ').filter(w => w && !PARSE_STOP.has(w)).map(w => (w.length > 3 ? w.replace(/(?<=[a-z])s$/, '') : w));

// Index de recherche (construit au premier appel) : nom ou alias → fiche, et la liste des formes avec leurs mots
let planIndex = null;
function planMatchIndex() {
  if (planIndex) return planIndex;
  const exact = new Map(), forms = [];
  const add = (text, name, weight = 1) => {
    const key = planMatchKey(text);
    if (!key) return;
    const wk = planWords(key).join(' ');
    if (!exact.has(key)) exact.set(key, name);
    if (wk && !exact.has(wk)) exact.set(wk, name);
    forms.push({ name, words: planWords(key), joined: planWords(key).join(''), weight, rank: catalogueRank(name) });
  };
  EXERCISE_CATALOGUE.forEach(e => { add(e.name, e.name); e.aliases.forEach(a => add(a, e.name)); });
  PARSE_EXTRA_ALIASES.forEach(([name, list]) => list.split('|').forEach(a => add(a, name, 0.97)));
  if (typeof IMPORT_ALIASES !== 'undefined') IMPORT_ALIASES.forEach(([name, list]) => list.split('|').forEach(a => add(a, name)));
  // Index inversé : mot → formes qui le contiennent ; début du nom collé → formes (mots collés d'une photo)
  const byWord = new Map(), byHead = new Map();
  forms.forEach(f => {
    new Set(f.words).forEach(w => { if (!byWord.has(w)) byWord.set(w, []); byWord.get(w).push(f); });
    const h = f.joined.slice(0, 2);
    if (!byHead.has(h)) byHead.set(h, []);
    byHead.get(h).push(f);
  });
  planIndex = { exact, forms, byWord, byHead, vocab: [...byWord.keys()], near: new Map() };
  return planIndex;
}
// Mots du vocabulaire qui ressemblent à w (mémorisé : la même faute revient d'une ligne à l'autre)
function planNearWords(idx, w) {
  if (idx.near.has(w)) return idx.near.get(w);
  const out = idx.vocab.filter(c => planWordSim(w, c) > 0);
  if (idx.near.size > 20000) idx.near.clear();
  idx.near.set(w, out);
  return out;
}

// Ressemblance de deux mots : 1 égaux, 0,9 abréviation (« inc », « halt »), 0,85 une faute, 0,75 deux fautes (mot long)
function planWordSim(q, c) {
  if (q === c) return 1;
  if (q.length >= 3 && c.startsWith(q) && q.length >= c.length / 2) return 0.9;
  if (c.length >= 3 && q.startsWith(c) && c.length >= q.length * 0.7) return 0.88;
  if (q.length >= 4 && c.length >= 4) {
    const d = editDistance(q, c, 2);
    if (d <= 1) return 0.85;
    if (d === 2 && Math.min(q.length, c.length) >= 7) return 0.75;
  }
  return 0;
}
// Score d'une forme pour les mots cherchés : Dice pondéré (chaque mot de la forme sert une fois), et mots collés
// (« developpecouche ») comparés d'un bloc. Le premier mot (le mouvement) pèse double
function planFormScore(qWords, qJoined, f) {
  if (!f.words.length || !qWords.length) return 0;
  const used = new Set();
  let got = 0;
  const weight = i => (i === 0 ? 2 : 1);
  qWords.forEach((w, i) => {
    let best = 0, bj = -1;
    f.words.forEach((c, j) => { if (!used.has(j)) { const s = planWordSim(w, c); if (s > best) { best = s; bj = j; } } });
    if (bj >= 0) used.add(bj);
    got += best * weight(i);
  });
  const qTotal = qWords.reduce((s, _, i) => s + weight(i), 0);
  const missing = f.words.length - used.size;
  // Part des mots cherchés trouvés, rabattue par les mots de la forme absents de la recherche et par les mots en trop
  let score = Math.min(1, got / qTotal) * (f.words.length / (f.words.length + missing * 0.6 + Math.max(0, qWords.length - f.words.length) * 0.35));
  if (score < 0.9 && qJoined.length >= 6 && f.joined.length >= 6 && Math.abs(qJoined.length - f.joined.length) <= 3) {
    const d = editDistance(qJoined, f.joined, 3);
    if (d <= Math.max(1, Math.floor(Math.max(qJoined.length, f.joined.length) / 6))) score = Math.max(score, 1 - d / Math.max(qJoined.length, f.joined.length) - 0.04);
  }
  return score * f.weight;
}

const PARSE_MATCH_MIN = 0.62;   // en dessous : pas reconnu (gardé sous son nom, « Pas compris »)
// Précisions qui ne changent pas la fiche (« Dips lestés », « Squat pause », « Tractions strictes ») : retirées en dernier recours
const PARSE_MODIFIERS = /\b(?:lest[ée]e?s?|lourde?s?|l[ée]g[eè]re?s?|explosi(?:f|ve)s?|strict(?:e|es|s)?|partiel(?:le)?s?|lents?|lente?s?|tempo|pause|avec\s+pause|weighted|paused|heavy|light)\b/gi;
const PARSE_MATCH_CACHE = new Map();
// Reconnaissance du nom brut. learned : dictionnaire appris { clé : nom } (planAliasKey, js/data/plan-aliases.js), lu
// d'abord ; le reste ne dépend que du texte et de la bibliothèque, mémorisé
function planMatchExercise(raw, learned = null) {
  const text = String(raw ?? '').trim().slice(0, 120);
  const none = { name: null, score: 0, how: 'none', raw: text };
  if (!/[a-zà-ÿ]{2,}/i.test(text)) return none;
  if (learned) {
    for (const v of planMatchVariants(text)) { const lk = planAliasKey(v); if (lk && learned[lk]) return { name: learned[lk], score: 1, how: 'learned', raw: text }; }
  }
  if (PARSE_MATCH_CACHE.has(text)) return { ...PARSE_MATCH_CACHE.get(text) };
  const r = planMatchLibrary(text, none);
  if (PARSE_MATCH_CACHE.size > 5000) PARSE_MATCH_CACHE.clear();
  PARSE_MATCH_CACHE.set(text, r);
  return { ...r };
}
// Variantes : tel quel, sans la parenthèse (« (prise serrée) », note), parenthèse ouverte (« Développé (haltères) »),
// avant un tiret ou deux-points (« Squat - talons surélevés »)
function planMatchVariants(text) {
  return [...new Set([text, text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim(), text.replace(/[()[\]]/g, ' ').trim(),
    text.split(/\s*:\s*/).slice(1).join(' ').trim(), text.split(/\s+[-–/]\s+|\s*:\s*/)[0].trim(),
    text.replace(PARSE_MODIFIERS, ' ').replace(/\s+/g, ' ').trim()].filter(v => v && /[a-z]/i.test(v)))];
}
function planMatchLibrary(text, none) {
  const variants = planMatchVariants(text);
  const idx = planMatchIndex();
  for (const v of variants) {
    const e = catalogueEntry(v);
    if (e) return { name: e.name, score: 1, how: 'catalogue', raw: text };
  }
  for (const v of variants) {
    const key = planMatchKey(v), wk = planWords(key).join(' ');
    const hit = idx.exact.get(key) || idx.exact.get(wk) || catalogueEntry(key)?.name;
    if (hit) return { name: hit, score: 0.96, how: 'alias', raw: text };
    const imp = typeof matchImportedExercise === 'function' ? matchImportedExercise(v) : null;
    if (imp) return { name: imp, score: 0.95, how: 'alias', raw: text };
  }
  // Recherche approchée sur toutes les formes
  let best = null;
  for (const v of variants) {
    const qWords = planWords(planMatchKey(v));
    if (!qWords.length) continue;
    const qJoined = qWords.join('');
    // Formes candidates : celles qui ont un mot proche d'un mot cherché, ou le même début une fois les mots collés
    const cand = new Set(idx.byHead.get(qJoined.slice(0, 2)) || []);
    qWords.forEach(w => planNearWords(idx, w).forEach(c => idx.byWord.get(c).forEach(f => cand.add(f))));
    for (const f of cand) {
      const s = planFormScore(qWords, qJoined, f);
      if (!best || s > best.score + 1e-9 || (Math.abs(s - best.score) <= 1e-9 && f.rank >= 0 && (best.rank < 0 || f.rank < best.rank))) best = { name: f.name, score: s, rank: f.rank };
    }
  }
  if (!best || best.score < PARSE_MATCH_MIN) return { ...none, guess: best && best.score >= 0.45 ? best.name : null };
  return { name: best.name, score: Math.round(Math.min(0.94, best.score) * 100) / 100, how: 'fuzzy', raw: text };
}
