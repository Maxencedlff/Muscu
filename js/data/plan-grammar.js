// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : grammaire des prescriptions d'une ligne.
//  « 4x8 », « 4 × 8-12 », « 4 séries de 8 », « quatre fois huit », « 3 × max », « 3 × 45 s », repos
//  (« 90 s », « 1'30 », « 1 min 30 »), charge (« 80 kg », « 70 % », RPE, RIR), tempo (« 3-1-1 »),
//  « par bras », techniques (drop set, rest-pause, cluster, dégressif, top set), repères de superset (A1, « + »).
//  Logique pure, sans écran ni donnée : planReadLine(texte) → { presc, name, marks }. Ce qui est lu est retiré de
//  la ligne ; il reste le nom de l'exercice, reconnu ensuite par js/data/plan-match.js.
// ═══════════════════════════════════════════════════════════
'use strict';

const PARSE_SETS_MAX = 10, PARSE_REPS_MAX = 100, PARSE_REST_MIN = 10, PARSE_REST_MAX = 600, PARSE_SECONDS_MAX = 600;

// ── Mise en forme du texte ───────────────────────────────────
// Espaces insécables, croix (×, *), tirets, apostrophes et guillemets typographiques ramenés à une seule forme ;
// émojis retirés (« 💪 », « 🔥 ») : le texte garde sa longueur utile, la casse et les accents
function planTidy(s) {
  return String(s ?? '').normalize('NFC')
    .replace(/[    ]/g, ' ')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|\u20E3/gu, ' ')
    .replace(/[×✕✖╳⨯]/g, 'x')
    .replace(/(\d)\s*\*\s*(\d)/g, '$1x$2')
    .replace(/[–—−‐‑]/g, '-')
    .replace(/[’‘´`ʼ]/g, '\'')
    .replace(/[″“”«»]/g, '"')
    .replace(/(?<=\d)[Øø]|[Øø](?=[\dØø])/g, '0')      // zéro barré d'un tableau blanc (« 3Ø », « 4ØØM »)
    .replace(/[ \t]+$/g, '');
}
// Minuscules sans accents, caractère par caractère : même longueur que le texte, pour retirer ce qui est lu au même endroit
function planPlain(s) {
  let out = '';
  for (const c of s) {
    const p = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += p.length === c.length ? p : (p[0] || ' ').repeat(c.length);
  }
  return out;
}

// ── Nombres en lettres ───────────────────────────────────────
// « quatre fois huit », « dix-huit », « vingt et une », « quatre-vingt-dix secondes », « one » à « twelve »
const PARSE_NUM_WORDS = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};
const PARSE_NUM_RE = new RegExp(`\\b(?:${Object.keys(PARSE_NUM_WORDS).sort((a, b) => b.length - a.length).join('|')})(?:(?:-|\\s+et\\s+|\\s+)(?:${Object.keys(PARSE_NUM_WORDS).join('|')}))*\\b`, 'gi');
function planNumberValue(words) {
  const parts = planPlain(words).split(/-|\s+et\s+|\s+/).filter(Boolean).map(w => PARSE_NUM_WORDS[w]);
  if (parts.some(v => v === undefined)) return null;
  let total = 0, cur = 0;
  for (const v of parts) {
    if (v === 100) cur = (cur || 1) * 100;
    else if (v === 20 && cur === 4) cur = 80;                 // quatre-vingt(s)
    else if (cur >= 20 && v < 20 && cur % 10 === 0) cur += v;  // vingt et un, soixante-dix, quatre-vingt-dix
    else if (cur && v < 10 && cur < 10) { total += cur; cur = v; }   // « quatre huit » : deux nombres
    else cur += v;
  }
  return total ? null : cur;
}
// Nombres en lettres écrits en chiffres. « un » et « une » seuls restent des mots hors d'une quantité (« un drop set ») ;
// devant une unité ou « fois », ils comptent (« une minute », « un bras » reste tel quel)
function planDigits(s) {
  const one = w => { const v = planNumberValue(w); return v === null || /^(un|une|one)$/i.test(w) ? w : String(v); };
  return s.replace(PARSE_NUM_RE, m => {
    const v = planNumberValue(m);
    // « quatre huit » : deux nombres, chacun écrit en chiffres
    return v === null ? m.replace(/[^\s-]+/g, one) : /^(un|une|one)$/i.test(m) ? m : String(v);
  }).replace(/\b(une?|one)\s+(minutes?|mn|min|series?|séries?|fois|serie|série|rep|reps|répétition)\b/gi, '1 $2')
    .replace(/(\d+)\s*(?:minutes?|min|mn)\s+et\s+demie?\b/gi, (m, n) => `${n} min 30`)
    .replace(/\bune\s+minute\s+et\s+demie?\b/gi, '1 min 30')
    .replace(/(\d+)\s*fois\s*(\d+)/gi, '$1 x $2');
}

// ── Lecture d'une ligne ──────────────────────────────────────
// Durée « 90 s », « 1'30 », « 1 min 30 », « 2 min », « 1:30 », « 1,5 min » → secondes (null si illisible)
const PARSE_TIME_SRC = String.raw`(\d{1,2})\s*(?:min(?:utes?)?|mn|m|')\s*(\d{1,2})\s*(?:s|sec|secondes?|"|'')?(?![a-z0-9])|(\d{1,2})[.,](\d)\s*(?:min(?:utes?)?|mn)(?![a-z])|(\d{1,2})\s*(?:min(?:utes?)?|mn|'(?!'))(?![a-z0-9'])|(\d{1,3})\s*(?:s|sec|secs|secondes?|"|'')(?![a-z0-9])|(\d{1,2}):([0-5]\d)(?![0-9])`;
function planTimeValue(m, k = 1) {
  if (m[k] !== undefined) return +m[k] * 60 + +m[k + 1];
  if (m[k + 2] !== undefined) return Math.round((+m[k + 2] + +m[k + 3] / 10) * 60);
  if (m[k + 4] !== undefined) return +m[k + 4] * 60;
  if (m[k + 5] !== undefined) return +m[k + 5];
  if (m[k + 6] !== undefined) return +m[k + 6] * 60 + +m[k + 7];
  return null;
}
const PARSE_TIME_GROUPS = 8;
const PARSE_REPS_SRC = String.raw`(max(?:imum)?|amrap|echec|l'echec|failure|fond)|(\d{1,3})((?:\s*(?:-|/|a|à|to|ou)\s*\d{1,3}(?![0-9])(?!\s*(?:min|mn|sec|s(?![a-z])|'|"|kg|%)))*)`;
const PARSE_RE = {
  tempoKw: /\btempo\s*[:=]?\s*\(?\s*([0-9x])\s*[-/. ]?\s*([0-9x])\s*[-/. ]?\s*([0-9x])(?:\s*[-/. ]?\s*([0-9x]))?\)?(?![0-9])/,
  tempoBare: /(?<![0-9x-])([0-9x])-([0-9x])-([0-9x])(?:-([0-9x]))?(?![0-9-])/,
  pct: /@?\s*(\d{2,3}(?:[.,]\d)?)\s*%\s*(?:(?:du|de\s+ton|de|of)\s+)?(?:max|1\s*rm|rm|1rm|cmr)?/,
  load: /(?:@|(?<![a-z])a)?\s*(\+?\d{1,3}(?:[.,]\d{1,2})?)\s*(kgs?|kilos?|lbs?|livres|#)(?![a-z])(?:\s*\/\s*\d{1,3}(?:[.,]\d{1,2})?\s*(?:kgs?|kilos?|lbs?|livres|#)?(?![a-z0-9]))*/,
  rpe: /\b(?:rpe|@)\s*[:=]?\s*(\d{1,2}(?:[.,]5)?)(?![0-9%])/,
  rir: [/\brir\s*[:=]?\s*(\d)(?![0-9])/, /(?<![0-9])(\d)\s*rir\b/, /(?<![0-9])(\d)\s*(?:reps?\s*)?(?:en|de)\s*reserve\b/],
  uni: /(?:\b(?:par|chaque|each|per)\s+|\/\s*)(bras|jambes?|cotes?|side|arm|leg|mains?)\b|\bde\s+chaque\s+cote\b|(?<=\d)\s*\/\s*s(?![a-z0-9])/,
  ssLead: /^\s*([a-f])\s*([1-6])\s*[).:-]?\s+(?=\S)/,
  ssWord: /\b(?:super\s*-?\s*set|superset|bi\s*-?\s*set|tri\s*-?\s*set|enchaine(?:r|z)?\s+avec|en\s+superset\s+avec|sans\s+repos\s+avec)\b/,
  setsReps: new RegExp(String.raw`(?<![0-9.,])(\d{1,2})\s*(?:x|series?\s*(?:de|x|of|au|a)?|sets?\s*(?:of|de|x)?|tours?\s*(?:de|x)?)\s*\(?\s*(?:(?:${PARSE_TIME_SRC})|(?:${PARSE_REPS_SRC}))\s*\)?\s*(?:(?:reps?|repetitions?|mouvements?|r)(?![a-z]))?`),
  repsThenSets: new RegExp(String.raw`(?<![0-9.,])(?:${PARSE_REPS_SRC})\s*(?:reps?|repetitions?)\s*(?:x|sur|en|,)?\s*(\d{1,2})\s*(?:series?|sets?|tours?)\b`),
  setsOnly: /(?<![0-9.,])(\d{1,2})\s*(?:series?|sets?|tours?)\b|\b(?:series?|sets?)\s*[:=]\s*(\d{1,2})(?![0-9])/,
  repsOnly: new RegExp(String.raw`(?<![0-9.,])(?:${PARSE_REPS_SRC})\s*(?:reps?|repetitions?|rep)\b|\b(?:reps?|repetitions?)\s*[:=]?\s*(?:${PARSE_REPS_SRC})`),
  restKw: new RegExp(String.raw`\b(?:repos|recup(?:eration)?|rest|pause|r)\s*[:=]?\s*(?:de\s+|of\s+)?(?:${PARSE_TIME_SRC})|(?:${PARSE_TIME_SRC})\s*(?:de\s+)?(?:repos|recup(?:eration)?|rest|pause|entre)`),
  timeBare: new RegExp(PARSE_TIME_SRC),
  amrapWord: /\b(?:jusqu'?a\s+l'?echec|a\s+l'?echec|amrap|max\s+reps?)\b/,
  // Accolade d'un bloc répété, en fin de ligne (« >x3 », « } x 3 ») : séries du bloc (planBlocks, js/data/plan-blocks.js)
  brace: /(?:^|\s)[>}\])]+\s*x\s*(\d{1,2})\s*$/,
  every: new RegExp(String.raw`\b(?:every|toutes?\s+les|chaque)\s+(?:${PARSE_TIME_SRC})`),
  setsDist: /(?<![0-9.,])(\d{1,2})\s*x\s*(\d{1,4}(?:[.,]\d)?)\s*(m|km)(?![a-z0-9'])/,
  dist: /(?<![0-9.,:/x])(\d{2,5}|\d{1,3}[.,]\d{1,2}|\d{1,3}(?=\s*(?:km|mi|miles?)))\s*(m|km|mi|miles?|yd|yards?|metres?|meters?)(?![a-z0-9'])/,
  // Reps en tête, avant le nom (« 10 PUSHUPS », « 36 BOX JUMPS », « 30-AIRSQUATS »), sans autre prescription
  lead: /^\s*(\d{1,3})(?:\s*-\s*|\s+)(?=[a-z]{2})(?!(?:min|mn|sec|secondes?|kgs?|kilos?|lbs?|livres|repos|rest|off|reps?|repetitions?|series?|sets?|fois|tours?|rounds?|rft|ans?|jours?|semaines?|heures?|cm|km|mi|miles?|metres?|meters?|minutes?|seances?|exercices?|mouvements?|calories?|cal)\b)/,
  // Reps en chaîne sans séries (« 12-10-8 TIRAGE », « SNATCH 1-1-1-1-1 », « 21-15-9 ») : une série par nombre
  chain: /(?<![0-9.,/:-])(\d{1,3})((?:\s*[-/]\s*\d{1,3}){2,9})(?![0-9/:-])/,
  // Charges à l'aveugle (« @ 245/250/250 » d'un carnet, « 95/65 » homme / femme) : sans unité, ôtées du nom
  bareLoads: /@\s*\d{2,4}(?:\s*[/|]\s*\d{0,4})*|(?<![0-9.,/x-])(\d{2,3})\s*\/\s*(\d{2,3})(?![0-9/])/,
};
// Distance en mètres (« 400 m », « 1,5 km », « 3 mi »)
function planMeters(n, unit) {
  const v = planDec(n), u = String(unit).toLowerCase();
  const k = /^k/.test(u) ? 1000 : /^mi/.test(u) ? 1609 : /^y/.test(u) ? 0.9144 : 1;
  const out = Math.round(v * k);
  return out >= 5 && out <= 100000 ? out : null;
}
const PARSE_TECH_RES = [
  ['topback', /\btop\s*-?\s*sets?\b|\bback\s*-?\s*offs?\b/],
  ['rp', /\brest\s*-?\s*pause\b|\brepos\s*-?\s*pause\b|(?<![a-z])rp(?![a-z])/],
  ['cluster', /\bclusters?(?:\s*-?\s*sets?)?\b/],
  ['drop', /\bdrop\s*-?\s*sets?\b|\bdropsets?\b|\bdegressi(?:f|fs|ve|ves|on)\b|\bstrip\s*-?\s*set\b|\bdrop\b/],
];
const PARSE_WHERE_ALL = /\b(?:toutes(?:\s+les\s+series)?|chaque\s+serie|sur\s+toutes|all\s+sets|every\s+set|a\s+chaque\s+serie)\b/;
const PARSE_WHERE_LAST = /\b(?:derniere|dernier|last|der\.)(?:\s+(?:serie|set))?\b/;

const clampInt = (v, lo, hi) => { const n = Math.round(+v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const planDec = s => +String(s).replace(',', '.');

// Bruit de lecture d'une photo (Apple Vision, scan) : chiffres pris pour des lettres dans un mot (« rep0s », « 5eries »,
// « 5ur ») et lettres prises pour des chiffres dans une prescription (« 4xl0 », « 3x1O »). Les jetons de prescription
// (« 4x8 », « 90s », « 1min30 », « 62,5kg ») et les repères de superset (« A1 ») ne sont pas touchés
const PARSE_UNIT_TAIL = /^(?:x\d.*|s|sec|secs|secondes?|min|mn|m|kg|kgs|kilos?|lbs?|reps?|x|er|re|e|eme|ere|rm|'.*|".*|h)$/;
function planDeOcr(s) {
  // « lO PUSHUPS », « IO BOX JUMPS » : 10 lu en lettres en tête de ligne, devant un nom
  s = s.replace(/^(\s*)[lI|1][oO0](?=\s+[A-Za-zÀ-ÿ]{3})/, '$110');
  return s.replace(/[A-Za-zÀ-ÿ0-9|]+/g, w => {
    if (!/[0-9|]/.test(w) || !/[A-Za-zÀ-ÿ]/.test(w)) return w;
    if (/^[A-Fa-f][1-6]$/.test(w) || /^x\d{1,2}$/i.test(w)) return w;
    const m = w.match(/^(\d+(?:[.,]\d+)?)(.*)$/);
    if (m) {
      // Commence par un nombre : « 4xl0 », « 3x1O » corrigés dans la prescription ; « 5ur », « 5eries » relus en mots
      const tail = m[2].replace(/(?<=x\d*)[lI|]|[lI|](?=\d)/g, '1').replace(/(?<=\d)[oO]|[oO](?=\d)/g, '0');
      if (/^x/i.test(tail) || PARSE_UNIT_TAIL.test(planPlain(tail))) return m[1] + tail;
      if (/^[a-zà-ÿ]{2,}$/i.test(m[2]) && m[1].length === 1) return planOcrLetters(m[1]) + m[2];
      return m[1] + tail;
    }
    return planOcrLetters(w);
  }).replace(/[A-Za-zÀ-ÿ]{3,8}/g, w => (typeof editDistance === 'function' && !PARSE_NO_FIX.has(planPlain(w)) ? planFixKeyword(w) : w));
}
// Mots proches d'un mot de prescription mais qui n'en sont pas (« mini », « rest », « sets »)
const PARSE_NO_FIX = new Set(['mini', 'rest', 'sets', 'reps', 'repo', 'tour', 'sera', 'ser', 'mon', 'mais', 'reste', 'temps', 'tours', 'series', 'serie', 'seme', 'sec', 'pecs', 'recto']);
// Mots de prescription relus malgré une faute (« rnin » → min, « scc » → sec, « repo » → repos, « sérles » → séries)
const PARSE_KEYWORDS = ['repos', 'recup', 'series', 'serie', 'secondes', 'sec', 'min', 'reps', 'tempo', 'tours', 'kilos', 'seance'];
function planFixKeyword(w) {
  const p = planPlain(w).replace(/rn/g, 'm');
  if (p.length < 3 || PARSE_KEYWORDS.includes(p)) return p === planPlain(w) ? w : p;
  const near = PARSE_KEYWORDS.find(k => Math.abs(k.length - p.length) <= 1 && k[0] === p[0] && editDistance(p, k, 1) <= 1 && k.length >= 5);
  return near || w;
}
const planOcrLetters = w => w.replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/5/g, 's').replace(/3/g, 'e').replace(/4/g, 'a').replace(/8/g, 'b').replace(/7/g, 't');

// Ligne lue. presc : ce qui est compris (champs absents = pas dit) ; name : le reste, nom de l'exercice brut ;
// marks : repères de mise en page (ss : « A1 » ; ssWord : « superset », « enchaîné avec » ; plus : « + » en tête)
// Hésitations de la dictée (« trois séries de euh cinq ») : ôtées avant la lecture des nombres
const PARSE_HESIT = /(?:^|\s)(?:euh+|heu+|hum+|hmm+|bah)(?=[\s,.;]|$)/gi;
function planReadLine(raw) {
  const text = planDigits(planDeOcr(planTidy(raw).replace(PARSE_HESIT, ' ')));
  let low = planPlain(text);
  const keep = Array(text.length).fill(true);
  const take = (m, from = 0) => {   // retire la correspondance m (sur low) et la masque pour les motifs suivants
    const a = (m.index ?? 0) + from, b = a + m[0].length - from;
    for (let i = a; i < b; i++) keep[i] = false;
    low = low.slice(0, a) + ' '.repeat(b - a) + low.slice(b);
  };
  const find = re => { const m = low.match(re); if (m) take(m); return m; };
  const presc = {}, marks = {};
  let m;
  // Repères de superset en tête : « A1) », « B2 - », « + »
  if ((m = low.match(PARSE_RE.ssLead)) && /^\s*[a-f]\s*[1-6]/.test(low)) { marks.ss = `${m[1].toUpperCase()}${m[2]}`; take(m); }
  if (/^\s*\+/.test(low)) { marks.plus = true; take(low.match(/^\s*\+/)); }
  if (/\+\s*$/.test(low)) { marks.plusAfter = true; take(low.match(/\+\s*$/)); }
  if ((m = low.match(PARSE_RE.ssWord))) { marks.ssWord = true; take(m); }
  if ((m = low.match(PARSE_RE.brace))) { marks.brace = +m[1]; take(m); }
  if ((m = find(PARSE_RE.tempoKw))) presc.tempo = planTempo(m);
  // Cadence d'un EMOM (« 3 reps every 3 minutes », « toutes les 2 min ») : le départ de chaque série, pas un repos
  if ((m = low.match(PARSE_RE.every))) { const v = planTimeValue(m, 1); take(m); if (v) presc.every = v; }
  // Distance (« 400 m », « Run 800m », « 3 mi », « 2x10m ») : notée, jamais lue comme des reps ni des minutes
  if ((m = low.match(PARSE_RE.setsDist))) { take(m); presc.sets = Math.min(clampInt(m[1], 1, 99) || 1, PARSE_SETS_MAX); presc.meters = planMeters(m[2], m[3]); }
  else if ((m = low.match(PARSE_RE.dist))) { const v = planMeters(m[1], m[2]); if (v) { take(m); presc.meters = v; } }
  if ((m = find(PARSE_RE.pct))) { const v = planDec(m[1]); if (v >= 30 && v <= 105) presc.pct = v; }
  if ((m = find(PARSE_RE.load))) {
    let v = planDec(m[1].replace('+', ''));
    if (/^l|#/.test(m[2])) v = Math.round(v / 2.20462 * 10) / 10;
    if (v > 0 && v <= 500) presc.load = v;
  }
  for (const re of PARSE_RE.rir) {   // « RIR 2 » d'abord : dans « 4 x 8 RIR 2 », le 8 est la rep, pas la réserve
    if ((m = low.match(re)) && clampInt(m[1], 0, 5) !== null) { take(m); presc.rir = clampInt(m[1], 0, 5); break; }
  }
  if ((m = find(PARSE_RE.rpe))) { const v = planDec(m[1]); if (v >= 5 && v <= 10) presc.rpe = v; }
  for (const [tech, re] of PARSE_TECH_RES) {
    if ((m = low.match(re))) {
      // « dernière série en drop set » : le mot de la série est lu avant ou après la technique
      presc.tech = tech; take(m);
      for (let k = 0, m2; k < 3 && (m2 = low.match(re)); k++) take(m2);   // « top set … back-off » : chaque mention
      const all = low.match(PARSE_WHERE_ALL), last = low.match(PARSE_WHERE_LAST);
      if (tech !== 'topback' && all) { presc.techWhere = 'all'; take(all); } else if (tech !== 'topback' && last) { presc.techWhere = 'last'; take(last); }
      break;
    }
  }
  if ((m = find(PARSE_RE.uni))) presc.uni = true;
  if ((m = find(/\b(?:pdc|bodyweight|bw)\b/))) presc.bodyweight = true;
  // Séries et reps : « 4x8 », « 4 séries de 8 à 12 », « 3 × max », « 3 × 45 s » ; puis « 10 reps × 4 séries » ; puis chacun seul
  if ((m = low.match(PARSE_RE.setsReps))) {
    const sets = clampInt(m[1], 1, 99);
    if (sets !== null) {
      take(m);
      presc.sets = Math.min(sets, PARSE_SETS_MAX);
      const sec = planTimeValue(m, 2);
      if (sec !== null) { const s = clampInt(sec, 1, PARSE_SECONDS_MAX); if (s) presc.seconds = s; }
      else planReps(presc, m[2 + PARSE_TIME_GROUPS], m[3 + PARSE_TIME_GROUPS], m[4 + PARSE_TIME_GROUPS]);
      // Deuxième bloc de séries sur la même ligne (« 1x5 top set puis 3x8 back-off ») : séries ajoutées, reps réunies
      const m2 = low.match(PARSE_RE.setsReps);
      if (m2 && presc.repMax !== undefined && planTimeValue(m2, 2) === null && !m2[2 + PARSE_TIME_GROUPS]) {
        const s2 = clampInt(m2[1], 1, PARSE_SETS_MAX), r2 = {};
        planReps(r2, undefined, m2[3 + PARSE_TIME_GROUPS], m2[4 + PARSE_TIME_GROUPS]);
        if (s2 && r2.repMax !== undefined) {
          take(m2);
          presc.sets = Math.min(presc.sets + s2, PARSE_SETS_MAX);
          presc.repMin = Math.min(presc.repMin, r2.repMin); presc.repMax = Math.max(presc.repMax, r2.repMax);
        }
      }
    }
  } else if ((m = low.match(PARSE_RE.repsThenSets))) {
    take(m);
    planReps(presc, m[1], m[2], m[3]);
    presc.sets = Math.min(clampInt(m[4], 1, 99) || 1, PARSE_SETS_MAX);
  } else {
    if ((m = find(PARSE_RE.setsOnly))) { const s = clampInt(m[1] ?? m[2], 1, 99); if (s) presc.sets = Math.min(s, PARSE_SETS_MAX); }
    if ((m = find(PARSE_RE.repsOnly))) planReps(presc, m[1] ?? m[4], m[2] ?? m[5], m[3] ?? m[6]);
  }
  if (!presc.amrap && presc.repMax === undefined && presc.seconds === undefined && (m = find(PARSE_RE.amrapWord))) presc.amrap = true;
  if (!planHasWork(presc) && !/\bdate\b/.test(low) && (m = low.match(PARSE_RE.chain))) {
    const nums = [m[1], ...m[2].split(/[-/]/).filter(x => x.trim())].map(x => clampInt(x.trim(), 1, PARSE_REPS_MAX));
    if (nums.every(x => x !== null)) { take(m); presc.sets = Math.min(nums.length, PARSE_SETS_MAX); planReps(presc, undefined, m[1], m[2]); }
  }
  if (!planHasWork(presc) && (m = low.match(PARSE_RE.lead))) {
    const n = clampInt(m[1], 1, PARSE_REPS_MAX);
    if (n !== null) { take(m); presc.repMin = n; presc.repMax = n; marks.lead = true; }
  }
  for (let k = 0; k < 4 && (m = low.match(PARSE_RE.bareLoads)); k++) {
    if (m[2] !== undefined && +m[1] < +m[2]) break;   // « 8/12 » : pas une paire de charges
    take(m);
  }
  if ((m = find(/\b(?:pas\s+de|sans|aucun|0\s*s(?:ec)?\s*de)\s+(?:repos|recup(?:eration)?|pause)\b|\brepos\s*[:=]?\s*(?:0|aucun|non|-)(?![0-9a-z])/))) presc.rest = 0;
  else if ((m = low.match(PARSE_RE.restKw))) {
    const off = m[1] !== undefined || m.slice(1, 1 + PARSE_TIME_GROUPS).some(x => x !== undefined) ? 1 : 1 + PARSE_TIME_GROUPS;
    const v = planTimeValue(m, off);
    if (v !== null && v < PARSE_REST_MIN) take(m);   // « pause 2 s en bas » : un temps de pause dans la rep, pas le repos
    else if (v !== null) { take(m); const r = clampInt(v, 1, 3600); if (r !== null) presc.rest = Math.min(Math.max(r, PARSE_REST_MIN), PARSE_REST_MAX); }
  }
  if (!presc.tempo && (m = low.match(PARSE_RE.tempoBare)) && /[01x]/.test(m.slice(1).join(''))) { take(m); presc.tempo = planTempo(m); }
  // Durée restée seule après les séries : le repos (« DC 4x8 2 min ») ; sans séries, un exercice en durée (« Gainage 45 s »)
  if (presc.rest === undefined && (m = low.match(PARSE_RE.timeBare))) {
    const v = planTimeValue(m, 1);
    if (v !== null) {
      // Pause d'un rest-pause ou d'un cluster (« rest-pause 15 s ») : pas le repos entre les séries
      if ((presc.tech === 'rp' || presc.tech === 'cluster') && v <= 30) take(m);
      else if (presc.sets !== undefined || presc.repMax !== undefined || presc.seconds !== undefined) {
        if (v >= 15) { take(m); presc.rest = Math.min(Math.max(v, PARSE_REST_MIN), PARSE_REST_MAX); }
      } else if (v <= PARSE_SECONDS_MAX) { take(m); presc.seconds = v; }
    }
  }
  const name = planCleanName([...text].map((c, i) => (keep[i] ? c : ' ')).join(''));
  return { presc, name, marks, text };
}
function planTempo(m) { return m.slice(1, 5).filter(x => x !== undefined).map(x => (x === 'x' ? 'X' : x)).join('-'); }
// Reps : un nombre (fixes), une fourchette « 8-12 », une pyramide « 12/10/8 » (de la plus basse à la plus haute), ou « max »
function planReps(presc, word, first, rest) {
  if (word) { presc.amrap = true; return; }
  const nums = [first, ...String(rest || '').split(/-|\/|(?<![a-z])a(?![a-z])|à|\bto\b|\bou\b/)].map(x => clampInt(String(x ?? '').trim(), 1, PARSE_REPS_MAX)).filter(x => x !== null);
  if (!nums.length) return;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  presc.repMin = lo; presc.repMax = hi;
  if (nums.length > 2) presc.pyramid = nums.join('/');
}

// ── Nom restant ──────────────────────────────────────────────
// Puces, numéros, mots de liaison et restes de prescription ôtés : « - 1) Fais 4 séries de 8 au développé couché, » → « développé couché »
const PARSE_LEAD_WORDS = /^(?:(?:(?:tu|on|vous|je)\s+[a-zà-ÿ]+(?:\s+(?:sur|avec|par|de|du|par))?|et|puis|ensuite|apres|après|enfin|termine|terminer|finis|finir|pour\s+finir|on\s+finit|on\s+enchaine|enchaine|enchaîne|commence|commencer|on\s+commence|tu\s+fais|fais|faire|fait|on\s+part\s+sur|on\s+fait|avec|par|au|aux|à|a|le|la|les|du|de|des|en|sur|exercice\s*\d*|exo\s*\d*|ex\s*\d*)\b[\s:,.-]*)+/i;
const PARSE_TAIL_WORDS = /(?:[\s,;:.-]+(?:et|puis|avec|de|des|du|à|a|au|en|sur|par|pour|reps?|répétitions?|repetitions?|séries?|series?|sets?|x|repos|récup|recup|rest|pause|entre|les|chaque|côté|cote|kg|tempo|rpe|rir|@|ou))+[\s,;:.-]*$/i;
// Mots de remplissage d'une dictée (« euh », « voilà », « pareil »)
const PARSE_FILLERS = /(?:^|\s)(?:euh+|heu+|hum+|bah|ben|voila|voilà|alors|bon|donc|ok|okay|pareil|genre|du coup|bref)(?=\s|$|[,.])/gi;
function planCleanName(s) {
  let n = String(s).replace(PARSE_FILLERS, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = n;
    n = n.replace(/^[\s\-•*·▪►>|:;,.=~]+/, '')
      .replace(/^\(?\d{1,2}\s*[).°]\s*(?=\S)/, '')
      .replace(/^(?:n°|no\.?|#)\s*\d+\s*/i, '')
      .replace(PARSE_LEAD_WORDS, '')
      .replace(PARSE_TAIL_WORDS, '')
      .replace(/\(\s*(?:(?:en|de|la|le|les|sur|a|à|au|et|avec|puis|la|serie|série|séries|series)\s*)*\)|\[\s*\]/gi, ' ')
      .replace(/\s*[|:;,.=~-]+\s*$/, '')
      .replace(/\s+/g, ' ').trim();
    if (n === before) break;
  }
  return n.replace(/^\((.*)\)$/, '$1').trim();
}

// Une prescription dit-elle quelque chose d'un exercice (séries, reps, durée, max) ?
function planHasWork(p) { return !!p && (p.sets !== undefined || p.repMax !== undefined || p.seconds !== undefined || !!p.amrap); }
// Prescription complète : séries et (reps, durée ou max)
function planWorkComplete(p) { return !!p && p.sets !== undefined && (p.repMax !== undefined || p.seconds !== undefined || !!p.amrap); }
// Complète a par b (ligne de suite : « Repos 2 min » sous l'exercice) sans écraser ce que a dit déjà
function planMergePresc(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (out[k] === undefined) out[k] = v;
  if (out.amrap && out.repMax !== undefined) delete out.amrap;
  return out;
}
