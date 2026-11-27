// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : blocs répétés d'un WOD ou d'un circuit.
//  - Ligne de bloc, seule sur sa ligne, qui vaut pour les exercices qui la suivent : « 5 rounds », « 6 RFT »,
//    « faire 4 tours », « x3 », « EMOM 12 », « Tabata », « 21-15-9 », « 2:00 each station », « AMRAP 10 min »,
//    « For time ». planBlockOf(texte) → { sets, seconds, repMin, repMax, pyramid, rest } (champs absents = rien) ou null.
//  - Accolade en fin de ligne (« 10 KB SWING >x3 ») : les lignes de reps voisines, jusqu'à une ligne d'une autre
//    sorte (« RUN 400M »), font un bloc enchaîné de N séries (planBraceRuns, à la fin de l'analyse).
//  Une prescription écrite sur l'exercice l'emporte toujours sur celle du bloc. Logique pure, sans écran.
// ═══════════════════════════════════════════════════════════
'use strict';

const PARSE_BLOCK_RES = [
  // Tours : « 5 rounds », « 6 RFT », « 3 tours », « 4 circuits », « Rounds : 3 », « x3 » seul
  ['rounds', /(?<![0-9.,:/])(\d{1,2})\s*(?:rounds?|rds?|rft|tours?|circuits?|giri)\b(?!\s+de\s+(?:piste|stade|terrain))|\b(?:rounds?|tours?)\s*[:x]\s*(\d{1,2})\b|^x\s*(\d{1,2})$/],
  // Minute par minute : « EMOM 12 », « EMOM x 10 min », « 12 min EMOM », « E2MOM 10 », « every minute for 10 minutes »
  ['emom', /\be(\d)?mom\s*(?:x\s*)?(\d{1,2})?|(\d{1,2})\s*(?:min(?:utes?)?|')?\s*e(\d)?mom\b|\bevery\s+minute\b.*?\b(\d{1,2})\s*min/],
  ['tabata', /\btabata\b/],
  // Bornes de temps sans séries : « AMRAP 10 min », « for time », « chrono », « metcon »
  ['open', /\bamrap\b|\bfor\s+time\b|\bau\s+chrono\b|\bmetcon\b|\bchipper\b/],
];
// « 2:00 each station », « 45 s par poste », « 1 min par atelier »
const PARSE_BLOCK_STATION = new RegExp(String.raw`(?:${PARSE_TIME_SRC})\s*(?:of\s+work\s+)?(?:each|per|par|chaque|a\s+chaque|on\s+each|for\s+each|sur\s+chaque)\s+(?:station|poste|atelier|exercice|exo|mouvement|movement|exercise)s?\b`);
const PARSE_BLOCK_EACH = new RegExp(String.raw`^(?:${PARSE_TIME_SRC})\s*(?:each|chacun|par poste|par atelier)$`);
// Mots qui ne disent rien de plus qu'un bloc (« WOD : 5 rounds for time of ») : ce qui reste doit être vide
const PARSE_BLOCK_FILL = /\b(?:wod|rounds?|rds?|rft|tours?|circuits?|for|time|of|reps?|rep|in|en|de|du|des|the|a|au|faire|fais|then|puis|minutes?|min|mn|sec|s|chrono|amrap|emom|tabata|metcon|chipper|as|many|possible|each|station|poste|atelier|par|chaque|x|repetitions?|series?|sets?|rest|repos|between|entre|les|la|le|et|and|with|avec|travail|work|on|off|every|minute|cap|time\s*cap|sur|giri|deux|trois)\b/g;
// Ligne de bloc : { sets?, seconds?, repMin?, repMax?, pyramid?, rest? } ou null (texte de la ligne, sans en-tête de tableau)
function planBlockOf(text) {
  const low = planPlain(planDigits(planTidy(text))).replace(/[*#_=~>|•·:()[\]!.,;-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!low || low.length > 70) return null;
  const out = {};
  let m, hit = false;
  for (const [kind, re] of PARSE_BLOCK_RES) {
    if (!(m = low.match(re))) continue;
    hit = true;
    if (kind === 'rounds') { const n = clampInt(m[1] ?? m[2] ?? m[3], 1, 99); if (n) out.sets = Math.min(n, PARSE_SETS_MAX); }
    else if (kind === 'emom') {
      const every = clampInt(m[1] ?? m[4] ?? 1, 1, 10), total = clampInt(m[2] ?? m[3] ?? m[5], 1, 99);
      if (total) out.sets = Math.min(Math.max(1, Math.floor(total / every)), PARSE_SETS_MAX);
    } else if (kind === 'tabata') Object.assign(out, { sets: 8, seconds: 20, rest: 10 });
    break;
  }
  // Durée de travail par poste : « 2:00 each station »
  const st = planPlain(planDigits(planTidy(text))).match(PARSE_BLOCK_STATION) || planPlain(planTidy(text)).trim().match(PARSE_BLOCK_EACH);
  if (st) { const v = planTimeValue(st, 1); if (v) { out.seconds = v; hit = true; } }
  // Reps en chaîne seules : « 21-15-9 », « 21-15-9 reps for time »
  const ch = low.match(/^(\d{1,3})((?:\s+\d{1,3}){2,9})(?:\s|$)/) || planPlain(planTidy(text)).trim().match(/^(\d{1,3})((?:\s*-\s*\d{1,3}){2,9})(?![0-9/:-])/);
  if (ch && !out.sets) {
    const nums = [ch[1], ...ch[2].split(/\s*-\s*|\s+/).filter(Boolean)].map(x => clampInt(x, 1, PARSE_REPS_MAX));
    if (nums.every(x => x !== null) && new Set(nums).size > 1) {
      out.sets = Math.min(nums.length, PARSE_SETS_MAX);
      out.repMin = Math.min(...nums); out.repMax = Math.max(...nums); out.pyramid = nums.join('/');
      hit = true;
    }
  }
  if (!hit) return null;
  // Rien d'autre sur la ligne qu'un bloc : un nom d'exercice (« 3 rounds de burpees ») n'en fait pas un bloc
  const rest = low.replace(PARSE_BLOCK_FILL, ' ').replace(/\d+/g, ' ').replace(/\b[a-z]\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (rest && planMatchExercise(rest).score >= PARSE_MATCH_MIN) return null;
  if (rest.split(' ').filter(w => w.length > 2).length > 2) return null;
  return out;
}
// Prescription d'un exercice complétée par son bloc : séries, puis durée ou reps seulement s'il n'en dit pas
function planBlockApply(presc, block) {
  if (!block) return presc;
  const p = { ...presc };
  if (p.sets === undefined && block.sets) p.sets = block.sets;
  const hasDose = p.repMax !== undefined || p.seconds !== undefined || !!p.amrap;
  if (!hasDose && block.seconds) p.seconds = block.seconds;
  if (!hasDose && block.repMax !== undefined) { p.repMin = block.repMin; p.repMax = block.repMax; if (block.pyramid) p.pyramid = block.pyramid; }
  if (p.rest === undefined && block.rest !== undefined && p.seconds !== undefined) p.rest = block.rest;
  return p;
}

// Accolades « >x3 » : chaque suite d'exercices en reps sans séries (bornée par une ligne d'une autre sorte, ou par
// une autre accolade) prend les séries de son accolade et devient un enchaînement (superset) dès deux exercices
function planBraceRuns(items, key) {
  const repOnly = it => it.presc.sets === undefined && (it.presc.repMax !== undefined || it.presc.seconds !== undefined) && !it.presc.meters;
  let i = 0;
  while (i < items.length) {
    if (!repOnly(items[i])) { i++; continue; }
    let j = i;
    while (j < items.length && repOnly(items[j])) j++;
    const run = items.slice(i, j), braces = run.filter(it => it.marks?.brace);
    if (braces.length) {
      // Plusieurs accolades dans une même suite : parts égales, dans l'ordre
      const size = Math.max(1, Math.round(run.length / braces.length));
      for (let k = 0; k < run.length; k += size) {
        const part = run.slice(k, k + size), n = part.find(it => it.marks?.brace)?.marks.brace || braces[0].marks.brace;
        const g = part.length > 1 ? key() : null;
        part.forEach(it => { it.presc.sets = Math.min(n, PARSE_SETS_MAX); if (g && !it.ss) it.ss = g; });
      }
    }
    i = j;
  }
}
