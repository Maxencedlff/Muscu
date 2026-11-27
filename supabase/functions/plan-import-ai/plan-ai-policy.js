// Règles de l'import aidé par l'IA (docs/IMPORT_IA.md), logique pure sans réseau : utilisée par index.ts (Deno) et
// testée par tests/unit/plan-import-ai.mjs (Node) et tests/deno/plan_import_ai.test.ts.
//
// 1. Entrée validée (validateInput) : trois modes, rien d'autre ne part vers le modèle.
//    - lines : seulement les lignes douteuses du moteur gratuit, chacune avec son contexte (séance, ligne d'avant,
//      ligne d'après) ; 40 lignes au plus ;
//    - plan : toutes les lignes du texte (déjà découpées par le moteur, planSourceLines), 20 000 caractères au plus ;
//    - image : une photo réduite (JPEG, PNG ou WebP, 2 Mo au plus), seulement avec consent: true.
//    Aucun champ pour un nom, un pseudo, un compte ou une donnée de santé : une clé inconnue est refusée.
// 2. Consigne stable (SYSTEM_RULES, puis la bibliothèque) : la partie mise en cache par Anthropic. La question
//    (userPrompt) vient après, seule partie qui change d'un appel à l'autre.
// 3. Sortie structurée (schemaFor) : l'exercice est le NUMÉRO d'une fiche de la bibliothèque (exercise_id) ou null ;
//    chaque champ est requis. Un numéro plutôt qu'une énumération des 191 noms : le schéma passe de 4 400 à quelques
//    centaines de tokens (mesuré avec count_tokens, docs/IMPORT_IA.md).
// 4. Validation serveur (checkAnswer) : nom hors bibliothèque → inconnu ; nombre hors bornes → refusé ; nombre
//    absent du texte de la ligne (en chiffres, en lettres ou en durée) → refusé et ligne à vérifier ; ligne incertaine
//    ou illisible → à vérifier ou pas compris. needsEscalation dit quelles lignes montent au modèle supérieur.
// 5. Brouillon rendu (buildDraft, lineResult) : la forme de js/data/plan-parser.js (planParse), pour l'écran
//    « Vérifier l'import » qui ne change pas.
// 6. Coût (costUsd) : prix publics par million de tokens, cache compris (docs/IMPORT_IA.md, « Prix »).
import { LIBRARY, LIBRARY_VERSION } from './library.js';

export const PROMPT_VERSION = 'p3';
// Cascade : le moins cher d'abord ; le second ne reçoit que les lignes que le premier n'a pas su lire sûrement
export const MODEL_FIRST = 'claude-haiku-5-5';
export const MODEL_SECOND = 'claude-sonnet-5-5';
// Prix publics (USD par million de tokens) : entrée, sortie, écriture du cache (5 min), lecture du cache
export const PRICES = Object.freeze({
  'claude-haiku-5-5': { in: 0.10, out: 0.50, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-sonnet-5-5': { in: 2.00, out: 10.00, cacheWrite: 2.50, cacheRead: 0.10 },
});
export const LIMITS = Object.freeze({
  bodyBytes: 3_500_000,     // image en base64 comprise
  planChars: 20_000,        // même borne que l'écran (PIMP_TEXT_MAX)
  planLines: 600,
  lineChars: 300,
  contextChars: 200,
  sessionChars: 40,
  targets: 40,
  imageBytes: 2_000_000,    // image déjà réduite par l'app (environ 1600 px)
  maxTokensPlan: 12_000,
  maxTokensLines: 4_000,
  escalateMax: 30,          // lignes envoyées au second modèle, au plus
  items: 300,
  sessions: 14,
});
const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TECH = ['drop', 'rp', 'cluster', 'topback'];

export const LIBRARY_NAMES = Object.freeze(LIBRARY.map(([n]) => n));
export { LIBRARY_VERSION };

// ── Entrée ──────────────────────────────────────────────────
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' && [...v].length <= max ? v : null);
// eslint-disable-next-line no-control-regex -- caractères de contrôle retirés du texte envoyé
const clean = s => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
const onlyKeys = (o, keys) => Object.keys(o).every(k => keys.includes(k));

/**
 * @param {any} body
 * @returns {{ ok: false, field: string } | { ok: true, value: { mode: 'lines', targets: Array<{ text: string, prev: string, next: string, session: string }> }
 *   | { mode: 'plan', lines: string[] } | { mode: 'image', image: { media_type: string, data: string } } }}
 */
export function validateInput(body) {
  if (!isObj(body)) return { ok: false, field: 'body' };
  const mode = body.mode;
  if (mode === 'lines') {
    if (!onlyKeys(body, ['mode', 'targets'])) return { ok: false, field: 'keys' };
    const t = body.targets;
    if (!Array.isArray(t) || !t.length || t.length > LIMITS.targets) return { ok: false, field: 'targets' };
    const targets = [];
    for (const x of t) {
      if (!isObj(x) || !onlyKeys(x, ['text', 'prev', 'next', 'session'])) return { ok: false, field: 'targets' };
      const text = str(x.text, LIMITS.lineChars);
      if (!text || !text.trim()) return { ok: false, field: 'targets' };
      const ctx = k => (x[k] === undefined || x[k] === null ? '' : str(x[k], k === 'session' ? LIMITS.sessionChars : LIMITS.contextChars));
      const prev = ctx('prev'), next = ctx('next'), session = ctx('session');
      if (prev === null || next === null || session === null) return { ok: false, field: 'targets' };
      targets.push({ text: clean(text), prev: clean(prev), next: clean(next), session: clean(session) });
    }
    return { ok: true, value: { mode, targets } };
  }
  if (mode === 'plan') {
    if (!onlyKeys(body, ['mode', 'lines'])) return { ok: false, field: 'keys' };
    const l = body.lines;
    if (!Array.isArray(l) || !l.length || l.length > LIMITS.planLines || l.some(x => typeof x !== 'string')) return { ok: false, field: 'lines' };
    if (l.reduce((n, x) => n + [...x].length, 0) > LIMITS.planChars) return { ok: false, field: 'lines' };
    if (!l.some(x => x.trim())) return { ok: false, field: 'lines' };
    return { ok: true, value: { mode, lines: l.map(clean) } };
  }
  if (mode === 'image') {
    if (!onlyKeys(body, ['mode', 'image', 'consent'])) return { ok: false, field: 'keys' };
    if (body.consent !== true) return { ok: false, field: 'consent' };
    const im = body.image;
    if (!isObj(im) || !onlyKeys(im, ['media_type', 'data']) || !MEDIA.has(im.media_type)) return { ok: false, field: 'image' };
    if (typeof im.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(im.data) || im.data.length % 4) return { ok: false, field: 'image' };
    if (im.data.length * 3 / 4 > LIMITS.imageBytes || im.data.length < 200) return { ok: false, field: 'image' };
    return { ok: true, value: { mode, image: { media_type: im.media_type, data: im.data } } };
  }
  return { ok: false, field: 'mode' };
}

// ── Consigne ────────────────────────────────────────────────
export const SYSTEM_RULES = `Tu lis des programmes de musculation écrits par des coachs : texte collé, texte lu sur une photo par un OCR (fautes de lecture possibles), dictée, ou photo. Tu les rends en données, pour qu'un coach les vérifie ensuite.

Règles absolues :
1. N'invente rien. Chaque nombre que tu rends doit être écrit dans la ligne, en chiffres ou en lettres (« 1'30 » ou « une minute trente » = 90 s). Un nombre qui n'est pas écrit : null.
2. L'exercice est UNIQUEMENT une fiche de la bibliothèque ci-dessous : exercise_id est son numéro (en tête de ligne ; alias et abréviations entre parenthèses, en français ou en anglais). Si aucune fiche n'est vraiment le même mouvement avec le même matériel, exercise_id vaut null : jamais une fiche seulement « proche ».
3. Une ligne illisible, coupée ou que tu ne comprends pas : confidence "unreadable", exercise_id null et nombres null. Ne devine jamais.
4. Si tu hésites entre deux exercices ou sur un nombre : confidence "uncertain". Sinon "sure".
5. Échauffement, retour au calme, conseils, notes et titres ne sont pas des exercices.

Champs d'un exercice : sets (séries) ; rep_min et rep_max (reps ; fixes : les deux égaux ; fourchette 8-12 : 8 et 12 ; pyramide 12/10/8 : 8 et 12) ; seconds (durée d'une série, en secondes) ; rest_s (repos en secondes) ; load_kg (charge en kg ; en livres : null) ; pct (% du max) ; rpe ; rir ; tempo (« 3-1-1 » ou « 3-0-1-0 », X pour explosif) ; amrap (max de reps ou jusqu'à l'échec) ; per_side (par bras ou par jambe) ; weighted (lesté) ; technique (drop : drop set ou dégressif ; rp : rest-pause ; cluster ; topback : une série lourde puis des séries allégées) et technique_where (last : dernière série, all : toutes).`;

// Bibliothèque : un exercice par ligne, « Nom (alias, alias) »
export const LIBRARY_PROMPT = `Bibliothèque (${LIBRARY.length} fiches, numéro puis nom) :\n${LIBRARY.map(([n, a], i) => (a.length ? `${i} ${n} (${a.join(', ')})` : `${i} ${n}`)).join('\n')}`;

// Blocs système : la règle, puis la bibliothèque marquée pour le cache (préfixe identique à chaque appel)
// cache : marque la bibliothèque pour le cache d'Anthropic (écriture 1,25 fois le prix d'entrée, lecture 0,1 fois)
export function systemBlocks({ cache = true } = {}) {
  return [
    { type: 'text', text: SYSTEM_RULES },
    { type: 'text', text: LIBRARY_PROMPT, ...(cache ? { cache_control: { type: 'ephemeral' } } : {}) },
  ];
}

const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();
export function userPrompt(input) {
  if (input.mode === 'lines') {
    const rows = input.targets.map((t, i) => `[${i}] séance : ${one(t.session) || '?'}\n  avant : ${one(t.prev) || '(rien)'}\n  LIGNE : ${one(t.text)}\n  après : ${one(t.next) || '(rien)'}`);
    return `Lignes à lire. Une réponse par ligne, avec son numéro (id), dans le même ordre. Lis seulement la LIGNE ; la séance et les lignes voisines sont là pour le contexte (par exemple un nom d'exercice coupé sur deux lignes). Une LIGNE qui n'est pas un exercice : exercise_id null, confidence "sure", nombres null.\n\n${rows.join('\n')}`;
  }
  if (input.mode === 'plan') {
    return `Programme complet, une ligne par numéro. Découpe-le en séances : header_line est le numéro de la ligne titre de la séance (« Lundi », « Push », « Séance A »…), null s'il n'y en a pas. Chaque exercice donne le numéro de sa première ligne (line) et de sa dernière (line_end : la même, ou jusqu'à 3 lignes plus bas quand le nom et ses séries ou reps sont sur des lignes qui se suivent) ; plusieurs exercices sur une même ligne : un élément chacun, même numéro. superset : une même lettre (A, B…) pour les exercices enchaînés d'une séance, sinon null. title_line : la ligne du nom du programme, ou null.\n\n${input.lines.map((l, i) => `L${i}: ${l}`).join('\n')}`;
  }
  return 'Photo d\'un programme. Transcris chaque ligne d\'exercice telle qu\'elle est écrite dans line_text (sans rien corriger ni compléter), et chaque titre de séance dans label. Une ligne illisible : line_text avec ce que tu lis, confidence "unreadable". superset : une même lettre pour les exercices enchaînés, sinon null. title : le nom du programme s\'il est écrit, sinon null.';
}

// ── Schéma de sortie ────────────────────────────────────────
const nul = t => ({ anyOf: [{ type: t }, { type: 'null' }] });
const ITEM_FIELDS = {
  exercise_id: nul('integer'),
  sets: nul('integer'), rep_min: nul('integer'), rep_max: nul('integer'), seconds: nul('integer'), rest_s: nul('integer'),
  load_kg: nul('number'), pct: nul('number'), rpe: nul('number'), rir: nul('integer'), tempo: nul('string'),
  amrap: { type: 'boolean' }, per_side: { type: 'boolean' }, weighted: { type: 'boolean' },
  technique: { anyOf: [{ type: 'string', enum: TECH }, { type: 'null' }] },
  technique_where: { anyOf: [{ type: 'string', enum: ['last', 'all'] }, { type: 'null' }] },
  confidence: { type: 'string', enum: ['sure', 'uncertain', 'unreadable'] },
};
const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
export function schemaFor(mode) {
  if (mode === 'lines') return obj({ answers: { type: 'array', items: obj({ id: { type: 'integer' }, ...ITEM_FIELDS }) } });
  if (mode === 'plan') {
    const item = obj({ line: { type: 'integer' }, line_end: { type: 'integer' }, superset: nul('string'), ...ITEM_FIELDS });
    return obj({ title_line: nul('integer'), sessions: { type: 'array', items: obj({ header_line: nul('integer'), items: { type: 'array', items: item } }) } });
  }
  const item = obj({ line_text: { type: 'string' }, superset: nul('string'), ...ITEM_FIELDS });
  return obj({ title: nul('string'), sessions: { type: 'array', items: obj({ label: nul('string'), items: { type: 'array', items: item } }) } });
}

// ── Nombres présents dans le texte ──────────────────────────
const WORDS = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, hundred: 100,
};
const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Nombres en lettres remis en chiffres (« vingt-cinq » → 25, « dix-huit » → 18, « soixante-dix » → 70)
export function wordsToDigits(text) {
  return plain(text).replace(/\b[a-z]+(?:(?:-|\s+et\s+|\s+)[a-z]+)*\b/g, seq => {
    const parts = seq.split(/(-|\s+et\s+|\s+)/);
    let out = '', acc = null;
    const flush = () => { if (acc !== null) { out += String(acc); acc = null; } };
    for (const p of parts) {
      if (/^(-|\s+et\s+|\s+)$/.test(p)) { if (acc === null) out += p; continue; }
      const v = WORDS[p];
      if (v === undefined) { flush(); out += (out && !/\s$/.test(out) ? ' ' : '') + p; continue; }
      if (acc === null) acc = v;
      else if (v === 100) acc = (acc || 1) * 100;
      else if (acc % 10 === 0 && acc >= 20 && v < 20) acc += v;
      else if (acc === 10 && v >= 7 && v <= 9) acc += v;
      else if (acc === 4 && v === 20) acc = 80;
      else { flush(); out += ' '; acc = v; }
    }
    flush();
    return out;
  });
}
// { nums, times } : nombres écrits dans la ligne, et durées en secondes (« 1'30 », « 2 min », « 90 s », « 1:30 »)
export function numbersIn(text) {
  const t = wordsToDigits(text).replace(/(\d),(\d)/g, '$1.$2');
  const nums = new Set(), times = new Set();
  for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) nums.add(+m[0]);
  const T = [
    [/(\d+)\s*(?:minutes?|mins?|mn|m|')\s*(\d{1,2})(?!\d)/g, m => +m[1] * 60 + +m[2]],
    [/(\d+)\.(\d)\s*(?:minutes?|mins?|mn)/g, m => +m[1] * 60 + +m[2] * 6],
    [/(\d+)\s*(?:minutes?|mins?|mn|')(?![a-z0-9])/g, m => +m[1] * 60],
    [/(\d+)\s*m(?![a-z0-9])/g, m => +m[1] * 60],
    [/(\d+)\s*(?:secondes?|secs?|s|")(?![a-z0-9])/g, m => +m[1]],
    [/(\d+):([0-5]\d)(?!\d)/g, m => +m[1] * 60 + +m[2]],
    [/(\d+)\s*(?:minutes?|mn|min)\s*et\s*demie?/g, m => +m[1] * 60 + 30],
  ];
  for (const [re, f] of T) for (const m of t.matchAll(re)) times.add(f(m));
  if (/\bminute\s+et\s+demie?\b/.test(t)) times.add(90);
  return { nums, times };
}

// ── Validation d'une réponse ────────────────────────────────
const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const numIn = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : undefined);
// Un élément du modèle → { name, presc, confidence, flags } ; source : le texte de la ligne (contrôle des nombres)
export function checkItem(a, source) {
  const flags = [];
  const id = a?.exercise_id;
  const name = Number.isInteger(id) && id >= 0 && id < LIBRARY_NAMES.length ? LIBRARY_NAMES[id] : null;
  if (id !== null && id !== undefined && !name) flags.push('hors-bibliotheque');
  const conf = ['sure', 'uncertain', 'unreadable'].includes(a?.confidence) ? a.confidence : 'uncertain';
  const { nums, times } = numbersIn(source);
  const seen = v => nums.has(v);
  const presc = {};
  const put = (key, v, ok) => {
    if (v === undefined || v === null) return;
    if (!ok) { flags.push('nombre'); return; }
    presc[key] = v;
  };
  const sets = intIn(a?.sets, 1, 10), rMin = intIn(a?.rep_min, 1, 100), rMax = intIn(a?.rep_max, 1, 100);
  if (a?.sets != null && sets === undefined) flags.push('borne');
  put('sets', sets, sets !== undefined && seen(sets));
  if (rMin !== undefined && rMax !== undefined && rMin <= rMax && seen(rMin) && seen(rMax)) {
    presc.repMin = rMin; presc.repMax = rMax;
  } else if (a?.rep_min != null || a?.rep_max != null) flags.push('nombre');
  const timeOk = v => times.has(v) || seen(v) || (v % 60 === 0 && seen(v / 60) && /min|mn|'/.test(plain(source)));
  const sec = intIn(a?.seconds, 1, 600);
  put('seconds', sec, sec !== undefined && timeOk(sec));
  if (a?.rest_s === 0) { if (/(?:sans|pas de|aucun|no)\s+(?:repos|recup|rest|pause)|repos\s*[:=]?\s*0/.test(wordsToDigits(source))) presc.rest = 0; else flags.push('nombre'); }
  else { const rest = intIn(a?.rest_s, 10, 600); if (a?.rest_s != null && rest === undefined) flags.push('borne'); put('rest', rest, rest !== undefined && timeOk(rest)); }
  const load = numIn(a?.load_kg, 0.5, 500); put('load', load, load !== undefined && seen(load));
  const pct = numIn(a?.pct, 30, 105); put('pct', pct, pct !== undefined && seen(pct));
  const rpe = numIn(a?.rpe, 5, 10); put('rpe', rpe, rpe !== undefined && seen(rpe));
  const rir = intIn(a?.rir, 0, 5); put('rir', rir, rir !== undefined && seen(rir));
  if (typeof a?.tempo === 'string') {
    const tp = a.tempo.toUpperCase().replace(/\s+/g, '');
    if (/^[0-9X](?:-[0-9X]){2,3}$/.test(tp) && plain(source).replace(/[\s-]/g, '').includes(tp.replace(/-/g, '').toLowerCase())) presc.tempo = tp;
    else flags.push('nombre');
  }
  if (a?.amrap === true) presc.amrap = true;
  if (a?.per_side === true) presc.uni = true;
  if (a?.weighted === true) presc.weighted = true;
  if (TECH.includes(a?.technique)) {
    presc.tech = a.technique;
    if (a.technique !== 'topback' && (a.technique_where === 'all' || a.technique_where === 'last')) presc.techWhere = a.technique_where;
  }
  if (presc.amrap) { delete presc.repMin; delete presc.repMax; }
  if (presc.seconds) { delete presc.repMin; delete presc.repMax; }
  return { name: conf === 'unreadable' ? null : name, presc: conf === 'unreadable' ? {} : presc, confidence: conf, flags: [...new Set(flags)] };
}
// Une ligne monte au modèle supérieur quand la VALIDATION échoue : nombre absent de la ligne ou hors bornes, numéro de
// fiche inexistant. Réglage « doute » (mesure seulement) : aussi une réponse incertaine ou illisible, et (unknownSure)
// une ligne lue sûrement comme hors bibliothèque. Mesuré le 27/11 sur le corpus réel (docs/IMPORT_IA.md) : monter
// sur le doute fait 26 fois le coût pour une justesse plus basse ; une ligne incertaine reste « à vérifier ».
export const needsEscalation = (r, { doubt = false, unknownSure = false } = {}) =>
  r.flags.length > 0 || (doubt && r.confidence !== 'sure') || (unknownSure && !r.name);
const hasWork = p => p.sets !== undefined && (p.repMax !== undefined || p.seconds !== undefined || p.amrap === true);

// Niveau de confiance de l'écran « Vérifier l'import » (planGrade de js/data/plan-parser.js) : pas compris, à vérifier, sûr
export function grade(r) {
  const why = [];
  if (r.confidence === 'unreadable') why.push('illisible');
  else if (!r.name) why.push('exercice');
  if (r.confidence === 'uncertain' && r.name) why.push('nom');
  if (r.flags.includes('nombre') || r.flags.includes('borne')) why.push('nombre');
  if (r.name && !hasWork(r.presc)) why.push(r.presc.sets === undefined ? 'séries' : 'reps');
  return { level: !r.name ? 'unknown' : why.length ? 'check' : 'sure', why };
}

// ── Lecture de la réponse du modèle ─────────────────────────
// Texte JSON de la sortie structurée → objet, ou null (réponse coupée, refus, JSON illisible)
export function parseModelJson(message) {
  if (!message || message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return null;
  const text = (message.content || []).filter(b => b?.type === 'text').map(b => b.text).join('');
  try { const v = JSON.parse(text); return isObj(v) ? v : null; } catch { return null; }
}
// Mode lines : une réponse par ligne demandée (id), contrôlée sur le texte de la ligne ; une ligne sans réponse est illisible
export function checkLines(answer, targets) {
  const byId = new Map();
  for (const a of Array.isArray(answer?.answers) ? answer.answers : []) if (Number.isInteger(a?.id) && !byId.has(a.id)) byId.set(a.id, a);
  return targets.map((t, i) => (byId.has(i) ? checkItem(byId.get(i), t.text) : { name: null, presc: {}, confidence: 'unreadable', flags: ['absente'] }));
}
// Mode plan et image : séances et éléments ; plan : chaque élément pointe une ligne existante (ses nombres y sont
// contrôlés), image : le texte transcrit par le modèle tient lieu de ligne
export function checkPlan(answer, input) {
  if (!Array.isArray(answer?.sessions)) return null;
  const sessions = [];
  let n = 0;
  for (const s of answer.sessions.slice(0, LIMITS.sessions)) {
    if (!isObj(s) || !Array.isArray(s.items)) continue;
    const items = [];
    for (const a of s.items) {
      if (n >= LIMITS.items) break;
      let src;
      const extra = [];
      if (input.mode === 'plan') {
        if (!Number.isInteger(a?.line) || a.line < 0 || a.line >= input.lines.length || !input.lines[a.line].trim()) continue;
        // Nom et prescription sur des lignes qui se suivent (« Chin-up » puis « 8 reps ») : les nombres sont cherchés
        // dans toutes, 4 lignes au plus
        const end = Number.isInteger(a.line_end) && a.line_end > a.line ? Math.min(a.line_end, a.line + 3, input.lines.length - 1) : a.line;
        src = input.lines.slice(a.line, end + 1).map(l => l.trim()).filter(Boolean).join(' · ');
        for (let k = a.line + 1; k <= end; k++) extra.push(k);
      } else {
        src = typeof a?.line_text === 'string' ? a.line_text.slice(0, LIMITS.lineChars).trim() : '';
        if (!src) continue;
      }
      items.push({ a, line: input.mode === 'plan' ? a.line : null, lines: input.mode === 'plan' ? [a.line, ...extra] : [], src, ss: typeof a?.superset === 'string' ? a.superset.slice(0, 3) : null, r: checkItem(a, src) });
      n++;
    }
    let label = '';
    if (input.mode === 'plan' && Number.isInteger(s.header_line) && s.header_line >= 0 && s.header_line < input.lines.length) label = input.lines[s.header_line];
    if (input.mode === 'image' && typeof s.label === 'string') label = s.label;
    if (items.length) sessions.push({ header: input.mode === 'plan' ? s.header_line ?? null : null, label: tidyLabel(label), items });
  }
  let title = null, titleLine = null;
  if (input.mode === 'plan' && Number.isInteger(answer.title_line) && answer.title_line >= 0 && answer.title_line < input.lines.length) {
    title = tidyLabel(input.lines[answer.title_line]) || null;
    titleLine = answer.title_line;
  }
  if (input.mode === 'image' && typeof answer.title === 'string') title = tidyLabel(answer.title) || null;
  return { title, titleLine, sessions, cut: { items: n >= LIMITS.items, sessions: answer.sessions.length > LIMITS.sessions } };
}
const tidyLabel = s => String(s ?? '').replace(/[*#_=~|]+/g, ' ').replace(/^[\s\-•·▪►>]+/, '').replace(/[\s:.\-–]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 40);

// ── Brouillon (forme de planParse) ──────────────────────────
// item : { id, src, raw, name, score, how: 'ai', guess, presc, marks, level, why, ss? } ; raw : la ligne (l'app en
// retire la prescription par sa grammaire, planReadLine)
export function buildDraft(plan, input) {
  let seq = 0;
  const lines = [];
  const used = new Set();
  const sessions = plan.sessions.map((s, si) => {
    const groups = new Map();
    const items = s.items.map(x => {
      for (const l of x.lines || []) used.add(l);
      const g = grade(x.r);
      const it = { id: `a${++seq}`, src: x.src, raw: x.src.trim().slice(0, 80), name: x.r.name, score: x.r.name ? 1 : 0, how: 'ai', guess: null,
        presc: x.r.presc, marks: {}, level: g.level, why: g.why };
      if (x.ss) { const k = groups.get(x.ss) || []; k.push(it); groups.set(x.ss, k); }
      return it;
    });
    let k = 0;
    for (const list of groups.values()) if (list.length >= 2) { k++; list.forEach(it => { it.ss = `s${si + 1}-${k}`; }); }
    if (s.header !== null) used.add(s.header);
    return { label: s.label || (plan.sessions.length > 1 ? `Séance ${String.fromCharCode(65 + si)}` : 'Séance'), src: null, items };
  });
  const notes = [];
  if (input.mode === 'plan') {
    input.lines.forEach((l, i) => {
      if (!l.trim()) { lines.push({ text: l, role: 'blank' }); return; }
      if (i === plan.titleLine) { lines.push({ text: l, role: 'title' }); return; }
      if (used.has(i)) { lines.push({ text: l, role: 'exercise' }); return; }
      lines.push({ text: l, role: 'note' }); notes.push(l.trim());
    });
  }
  const all = sessions.flatMap(s => s.items);
  return {
    title: plan.title, sessions, lines, notes,
    cut: { text: false, items: !!plan.cut?.items, sessions: !!plan.cut?.sessions },
    stats: { items: all.length, sure: all.filter(x => x.level === 'sure').length, check: all.filter(x => x.level === 'check').length,
      unknown: all.filter(x => x.level === 'unknown').length, sessions: sessions.length },
  };
}
// Mode lines : ce que l'app applique à la ligne i de sa demande
export function lineResult(r, i) {
  const g = grade(r);
  return { i, name: r.name, presc: r.presc, confidence: r.confidence, level: g.level, why: g.why };
}

// ── Coût ────────────────────────────────────────────────────
// usage de la réponse d'Anthropic → dollars facturés (entrée, sortie dont la réflexion, écriture et lecture du cache)
export function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return 0;
  const n = k => (Number.isFinite(usage[k]) && usage[k] > 0 ? usage[k] : 0);
  return (n('input_tokens') * p.in + n('output_tokens') * p.out + n('cache_creation_input_tokens') * p.cacheWrite + n('cache_read_input_tokens') * p.cacheRead) / 1e6;
}
// Plafond de dépense réservé avant l'appel (le pire cas, retenu jusqu'au coût réel) : entrée bornée, sortie à max_tokens
export function worstCaseUsd(model, inputChars, maxTokens, image = false) {
  const p = PRICES[model];
  const inTok = Math.ceil((inputChars + LIBRARY_PROMPT.length + SYSTEM_RULES.length) / 2.5) + (image ? 5000 : 0);
  return (inTok * p.cacheWrite + maxTokens * p.out) / 1e6;
}

// ── Clés du cache de résultats ──────────────────────────────
// Texte normalisé (casse, accents gardés, espaces) : le même plan importé deux fois a la même empreinte
export const normLine = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const cacheMaterial = (kind, parts) => [PROMPT_VERSION, LIBRARY_VERSION, MODEL_FIRST, MODEL_SECOND, kind, ...parts].join('␞');
