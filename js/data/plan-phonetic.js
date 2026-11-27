// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : phonétique simplifiée du français, pour la dictée.
//  La reconnaissance vocale écrit ce qu'elle entend : « alter » pour haltère, « poule » pour pull, « quête Lebel »
//  pour kettlebell, « Lip trust » pour hip thrust, « SCA » pour squat, « humain » pour roumain. Deux écritures qui se
//  prononcent pareil (ou presque) ont la même clé : planPhon(mot) → clé ; planPhonKey(texte) → clés des mots collées.
//  Règles générales de lecture du français (et des mots anglais des salles lus à la française), pas une liste de cas :
//  lettres muettes (h, finales s t d x z, e final), -er / -ez / -é, digrammes (ph, qu, ch, gn, ou, au, eau, ai, ei, oi),
//  nasales (an en am em, in ain ein un, on), c et g doux, s entre voyelles, lettres doublées, w et oo anglais.
//  Sert en dernier recours (planMatchLibrary, js/data/plan-match.js ; nombres dictés, js/data/plan-grammar.js).
//  Logique pure, sans écran.
// ═══════════════════════════════════════════════════════════
'use strict';

const PARSE_PHON_CACHE = new Map();
function planPhon(word) {
  let w = String(word ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';
  if (PARSE_PHON_CACHE.has(w)) return PARSE_PHON_CACHE.get(w);
  const src = w;
  w = w.replace(/sch|sh|ch/g, 'S')                 // « ch » français, « sh » anglais
    .replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'k').replace(/qu|q/g, 'k').replace(/gn/g, 'ni')
    .replace(/gu(?=[eiy])/g, 'g').replace(/g(?=[eiy])/g, 'j')
    .replace(/cc(?=[eiy])/g, 'ks').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/eau|au/g, 'o').replace(/oo|ou|w/g, 'u').replace(/oi/g, 'ua').replace(/ai|ei/g, 'e').replace(/y/g, 'i')
    .replace(/h/g, '');
  // Fin de mot muette, une seule fois : pluriel (s, x), t et d (« squat », « thrust »), puis -ère / -er / -ez / -et
  // comme -é (« haltère » et « alter », « marcher » et « marchées »), puis e final
  w = w.replace(/(.)\1+/g, '$1').replace(/(?<=..)[sx]$/, '').replace(/(?<=..)[td]$/, '').replace(/ere$/, 'er').replace(/(?<=.)e[rzt]$/, 'e').replace(/(?<=..)e$/, '');
  w = w.replace(/x/g, 'ks')
    // Nasales devant une consonne ou en fin de mot
    .replace(/(?:an|en|am|em)(?![aeiouAIO]|n|m)/g, 'A').replace(/(?:in|im|un|um)(?![aeiouAIO]|n|m)/g, 'I').replace(/(?:on|om)(?![aeiouAIO]|n|m)/g, 'O')
    .replace(/(?<=[aeiouAIO])s(?=[aeiouAIO])/g, 'z')
    .replace(/(.)\1+/g, '$1');
  if (PARSE_PHON_CACHE.size > 20000) PARSE_PHON_CACHE.clear();
  PARSE_PHON_CACHE.set(src, w);
  return w;
}
// Clé d'un groupe de mots : les clés collées (« quête Lebel » et « kettlebell » donnent la même)
const planPhonKey = text => String(text ?? '').split(/[\s'’-]+/).map(planPhon).join('');
// Écart toléré entre deux clés, avec le même premier son : aucun en dessous de 8 sons, une faute jusqu’à 10, deux au-delà
// (un premier son différent : une seule faute, à partir de 6 sons des deux côtés : « Lip trust » pour hip thrust)
function planPhonNear(a, b) {
  if (!a || !b || Math.min(a.length, b.length) < 4) return Infinity;
  const n = Math.max(a.length, b.length);
  const tol = a[0] !== b[0] ? (Math.min(a.length, b.length) >= 6 ? 1 : 0) : n >= 11 ? 2 : n >= 8 ? 1 : 0;
  if (!tol && a !== b) return Infinity;
  const d = editDistance(a, b, tol);
  return d <= tol ? d : Infinity;
}
