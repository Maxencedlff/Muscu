// ═══════════════════════════════════════════════════════════
//  Import d'un programme (docs/IMPORT_PROGRAMME.md) : du texte au programme brouillon.
//  Le texte vient d'un collage, d'un PDF, d'une photo ou d'une dictée ; tout passe par ici :
//   1. découpage en lignes (une dictée sans retour à la ligne est recoupée aux « ensuite », « séance… » et entre deux
//      prescriptions ; « Lundi : DC 4x8, squat 5x5 » donne une séance et deux exercices) ;
//   2. rôle de chaque ligne : en-tête de séance (« Lundi », « Séance A », « Push », « Jour 1 »), jour de repos, tableau
//      (js/data/plan-table.js), exercice (grammaire : js/data/plan-grammar.js ; nom : js/data/plan-match.js), ligne de
//      suite (« Repos 2 min » sous l'exercice), note ;
//   3. supersets (A1 / A2, « + », « enchaîné avec », « Superset : ») ;
//   4. confiance par ligne : sûr, à vérifier, pas compris.
//  planParse(texte, { learned }) → brouillon ; planDraftProgramme(brouillon, nom) → { up, pd } (comme genProgrammeData).
//  Logique pure, sans écran.
// ═══════════════════════════════════════════════════════════
'use strict';

const PARSE_MAX_CHARS = 60000, PARSE_MAX_LINES = 1500, PARSE_MAX_ITEMS = 300, PARSE_MAX_SESSIONS = 14;
const PARSE_LABEL_MAX = 40, PARSE_NAME_MAX = 80;

const PARSE_DAYS = 'lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lun|mar|mer|jeu|ven|sam|dim';
const PARSE_SPLIT_WORDS = new Set(('push|pull|leg|legs|jambes|jambe|haut|bas|corps|du|entier|upper|lower|body|full|fullbody|pecs|pec|pectoraux|dos|epaules|epaule|bras|biceps|' +
  'triceps|abdominals|neck|cou|fessiers|fessier|cuisses|ischios|quadriceps|quads|abdos|abdominaux|cardio|torse|poitrine|chest|back|shoulders|arms|glutes|tirage|poussee|pousser|' +
  'tirer|force|hypertrophie|puissance|power|strength|mollets|trapezes|avant|arriere|posterieur|anterieure|anterieur|chaine|et|and|day|jour|a|b|c|d|1|2|3|4|5|6|7|' +
  'seance|session|workout|entrainement|training|semaine|week|split|ppl|phul|phat|lourd|leger|heavy|light|volume|intensite|technique|accessoires|' +
  'complet|core|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|semaine|suivante|premiere|deuxieme|troisieme|quatrieme|derniere|1re|2e|3e|4e').split('|'));
const PARSE_HEAD_RE = new RegExp(`^(?:(?:${PARSE_DAYS})\\b|(?:seance|session|workout|entrainement|training)\\b|(?:jour|day|j|bloc)\\s*(?:n°|no|#)?\\s*[a-z0-9]{1,3}\\b|(?:premiere|deuxieme|troisieme|quatrieme|cinquieme|sixieme|1re|2e|3e|4e|5e|6e|1ere|2eme|3eme|4eme|5eme)\\s+seance\\b|seance\\s+(?:suivante|du|de|des|d')\\b)`);
const PARSE_REST_DAY_RE = new RegExp(`^(?:(?:${PARSE_DAYS}|jour\\s*\\d+|day\\s*\\d+|j\\s*\\d+)\\s*[:\\-]?\\s*)?(?:repos|off|rest|recuperation|recup|repos complet|repos actif|jour de repos|rest day|day off)(?:\\s+(?:complet|actif|total))?\\s*[.!]*$`);
const PARSE_SKIP_SECTION_RE = /^(?:echauffement|echauffements|warm\s*-?\s*up|retour au calme|cool\s*-?\s*down|etirements?|stretching|mobilite|notes?|conseils?|remarques?|important|nutrition|alimentation)\b/;
const PARSE_WARMUP_ANY = /\b(?:echauffements?|warm\s*-?\s*ups?|retour au calme|cool\s*-?\s*down|etirements?|stretching)\b/;
// Mots qui recoupent une dictée (pas de retour à la ligne) : un nouvel exercice ou une nouvelle séance commence
const PARSE_DICT_BREAK = /\s+(?=(?:ensuite|puis|apres ca|apres|et pour finir|pour finir|on termine|on enchaine|on finit|enfin|exercice suivant|dernier exercice|et on finit|on passe a)\b)/gi;
const PARSE_DICT_SESSION = new RegExp(`\\s+(?=(?:(?:premiere|deuxieme|troisieme|quatrieme|cinquieme|1re|2e|3e|4e)\\s+seance|seances?\\s+(?:suivantes?|[a-z0-9]{1,3}\\b|push|pull|jambes|legs|haut|bas)|jour\\s+\\d|(?:${PARSE_DAYS})\\b))`, 'gi');

const PARSE_DATE_LINE = /\bdate\s*:|^(?:(?:le|du|on)\s+)?(?:\w+\s+)?\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4})$/;
// Ligne de groupe d'un tableau ou d'une liste : « Superset modifié », « Biset abdos », « Tri-set » ouvrent un groupe ;
// « En séries combinées avec », « enchaîné avec » seuls sur leur ligne relient l'exercice d'avant à celui d'après
const PARSE_GROUP_OPEN = /^(?:super\s*-?\s*sets?|bi\s*-?\s*sets?|tri\s*-?\s*sets?|giant\s*sets?|series?\s+combinees?|series?\s+enchainees?)\b/;
const PARSE_GROUP_JOIN = /^(?:en\s+)?(?:series?\s+combinees?|combine(?:e|es|s)?|enchaine(?:e|es|s|r|z)?|en\s+superset|superset|en\s+biset|alterne(?:e|es|s)?|alternance)\s+(?:avec|with)\s*:?$|^(?:with|avec)\s+(?:the\s+)?next$/;
// Ligne de texte simple, minuscules sans accents, sans puces ni décorations (« ## », « ** », « === »)
const planBare = s => planPlain(planTidy(s)).replace(/[*#_=~]+/g, ' ').replace(/^[\s\-•·▪►>|]+/, '').replace(/\s+/g, ' ').trim();

// En-tête de séance : { label, rest } ou null. read : la ligne lue par la grammaire
function planHeaderOf(line, read) {
  let b = planBare(line).replace(/[:.-]+$/, '').trim();
  // Premier mot mal lu (« Séancc 2 », « Lundl ») : rapproché du mot de séance ou du jour
  const w0 = b.split(' ')[0];
  if (w0.length >= 5 && !PARSE_HEAD_RE.test(b)) {
    const near = ['seance', 'session', 'workout', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].find(k => editDistance(w0, k, 1) <= 1);
    if (near) b = near + b.slice(w0.length);
  }
  if (!b || b.length > 70) return null;
  if (PARSE_REST_DAY_RE.test(b)) return { rest: true, label: '' };
  if (planHasWork(read.presc)) return null;
  const words = b.split(/[\s/+&,()-]+/).filter(Boolean);
  const label = planLabel(line);
  if (PARSE_HEAD_RE.test(b) && words.length <= 9) return { label, strong: true };
  if (words.length <= 6 && words.every(w => PARSE_SPLIT_WORDS.has(w)) && !words.every(w => /^(?:et|and|du|de|a)$/.test(w))) return { label };
  // « PUSH », « JAMBES / FESSIERS » en capitales, ou une ligne courte finie par « : » qui n'est pas un exercice
  const letters = planTidy(line).replace(/[^A-Za-zÀ-ÿ]/g, '');
  const caps = letters.length >= 3 && letters === letters.toUpperCase();
  if ((caps || /:\s*$/.test(line)) && words.length <= 5 && !/^\s*[([]/.test(planTidy(line))) {
    const m = planMatchExercise(read.name);
    if (m.score < 0.9) return { label };
  }
  return null;
}
// Libellé lisible d'un en-tête : décorations ôtées, casse gardée (« LUNDI - PUSH » devient « Lundi - Push »)
function planLabel(line) {
  let t = planTidy(line).replace(/[*#_=~]+/g, ' ').replace(/^[\s\-•·▪►>|]+/, '').replace(/[\s:.\-–|]+$/, '').replace(/\s+/g, ' ').trim();
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) t = t.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
  return t.slice(0, PARSE_LABEL_MAX).trim();
}

// Morceau de dictée qui ne dit qu'une correction (« attends non », « euh pardon », « non plutôt »)
const PARSE_CORRECTION = /^(?:(?:attends?|non|pardon|plutot|en fait|enfin|je veux dire|correction|oups|ah)\s*)+$/;
function planNextIsTableHead(src, i) {
  for (let j = i + 1; j < src.length && j <= i + 2; j++) if (src[j].trim()) return !!planTableHeader(src[j]);
  return false;
}
function planRowNotDosed(row) {
  if (!row || row.single) return false;
  const vals = ['sets', 'reps', 'setsReps'].map(k => row[k]).filter(Boolean);
  return vals.length > 0 && vals.every(v => !/\d|max|amrap|echec|échec/i.test(v)) && vals.some(v => /[a-zà-ÿ]{3}/i.test(v));
}
// Mot d'un en-tête de séance, au singulier ou au pluriel (« séances », « abdo »), écrit comme il est entendu par la
// dictée (« d'eau » pour dos, « poule » pour pull : même prononciation, planPhon)
let PARSE_SPLIT_PHON = null;
function planIsSplitWord(word) {
  const w = planPlain(word).replace(/[^a-z0-9']/g, '').replace(/^[dl]'/, '').replace(/'/g, '');
  if (!w) return false;
  if (PARSE_SPLIT_WORDS.has(w) || PARSE_SPLIT_WORDS.has(w.replace(/s$/, '')) || PARSE_SPLIT_WORDS.has(`${w}s`)) return true;
  if (typeof planPhon !== 'function' || w.length < 3 || /\d/.test(w)) return false;
  PARSE_SPLIT_PHON ||= new Set([...PARSE_SPLIT_WORDS].filter(x => x.length >= 3 && !/\d/.test(x)).map(planPhon).filter(x => x.length >= 2));
  return PARSE_SPLIT_PHON.has(planPhon(w));
}
// Sous-titre fait seulement de groupes musculaires (« PECTORAUX », « CUISSES / FESSIERS », « Pectoraux, biceps et abdos »)
const planSplitOnly = b => { const w = b.split(/[\s/+&,()-]+/).filter(Boolean); return w.length > 0 && w.length <= 6 && w.every(x => PARSE_SPLIT_WORDS.has(x)); };
// En-tête collé à son premier exercice, sans deux-points : mots de séance en tête (« séance suivante jambes »), puis un
// exercice reconnu qui prescrit un travail. { label, rest } ou null
// first : rien n'a encore été lu ; une dictée commence souvent par la séance sans le mot (« bras biceps triceps curl… »)
function planHeadSplit(text, learned, first = false) {
  const t = planTidy(text);
  const low = planPlain(t);
  const said = PARSE_HEAD_RE.test(low) || new RegExp(`^(?:${PARSE_DAYS})\\b`).test(low);
  if (!said && !first) return null;
  const words = [...t.matchAll(/\S+/g)];
  let k = 0;
  while (k < words.length && k < 6 && planIsSplitWord(words[k][0])) k++;
  if (!k || k >= words.length) return null;
  const rest = t.slice(words[k].index);
  const r = planPieceRead(planSplitLine(rest)[0]);
  // Mot de séance dit (« séances suivantes bas du corps … 4 × 6 ») : la séance commence même si l'exercice est mal entendu
  const strongSaid = said && /\b(?:seances?|session|workout)\b/.test(low.slice(0, words[k].index));
  if (!planHasWork(r.presc) || (!strongSaid && planMatchExercise(r.name, learned).score < PARSE_MATCH_MIN)) return null;
  // Sans mot de séance : seulement si la ligne entière n'est pas déjà un exercice (« biceps curl 3x10 » en est un)
  if (!said && planMatchExercise(planReadLine(planSplitLine(t)[0].text).name, learned).score >= PARSE_MATCH_MIN) return null;
  return { label: planLabel(t.slice(0, words[k].index)), rest };
}

// ── Découpage ────────────────────────────────────────────────
// Lignes du texte, une dictée recoupée ; chaque ligne garde son texte source pour l'écran de vérification
function planSourceLines(text) {
  let s = planTidy(String(text ?? '').slice(0, PARSE_MAX_CHARS)).replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  const long = lines.filter(l => l.length > 160);
  // Dictée ou paragraphe : coupé aux mots de passage et aux séances, en gardant la phrase source
  const few = lines.filter(l => l.trim()).length <= 3;
  if (long.length || (few && lines.some(l => l.length > 80))) {
    s = lines.map(l => (l.length > 160 || (few && l.length > 80) ? planPlainSafe(l) : l)).join('\n');
  }
  const all = s.split('\n'), out = all.slice(0, PARSE_MAX_LINES);
  out.cut = all.length > PARSE_MAX_LINES || String(text ?? '').length > PARSE_MAX_CHARS;   // texte coupé : dit à l'écran
  return out;
}
// Coupe sur une copie sans accents mais garde le texte d'origine : on repère les positions sur la forme simple
function planPlainSafe(l) {
  const low = planPlain(l);
  const cuts = new Map();   // position → coupure à un point (gardée seulement si la phrase d'avant prescrit déjà)
  [[PARSE_DICT_SESSION, false], [PARSE_DICT_BREAK, false], [/\s*[.;]\s+(?=\S)/g, true]].forEach(([re, dot]) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(low))) { if (!cuts.has(m.index) || !dot) cuts.set(m.index, dot); if (m[0] === '') re.lastIndex++; }
  });
  let out = '', last = 0;
  // Le point mis par la reconnaissance vocale au milieu d'un exercice (« développé couché. Barre quatre fois huit ») ne
  // coupe pas : la phrase d'avant nomme un exercice sans rien prescrire encore
  [...cuts.keys()].sort((a, b) => a - b).forEach(i => {
    const before = cuts.get(i) ? planReadLine(l.slice(last, i)) : null;
    if (before && !planHasWork(before.presc) && planMatchExercise(before.name).score >= PARSE_MATCH_MIN) return;
    out += `${l.slice(last, i).trimEnd()}\n`; last = i;
  });
  return (out + l.slice(last)).replace(/\n\s*[.;]\s*/g, '\n').replace(/^\s+/gm, '').replace(/(?<=\S)\.\s+(?=\S)/g, ' ');
}

// Une ligne qui porte plusieurs exercices (« DC 4x8, squat 5x5 », « curl 3x12 + extension 3x12 », dictée « développé
// couché 4 fois 8 squat 5 fois 5 ») → morceaux { text, join } ; join : le morceau est enchaîné avec le précédent (superset)
function planSplitLine(line) {
  const t = planTidy(line);
  // Séparateurs explicites, gardés seulement si chaque morceau prescrit un travail
  const SEP = /\s*(?:,|;|\s\+\s|\s\/\s|\s(?:et|puis|ensuite|then)\s|\s(?:encha[iî]n\S*|en superset|superset|bi-?set)\s+(?:avec|sur)\s|\s(?:suivi|suivie|suivis)\s+(?:de|du|d')\s?)\s*/i;
  const parts = [];
  let rest = t, guard = 0;
  while (guard++ < 12) {
    const m = rest.match(SEP);
    if (!m) break;
    const a = rest.slice(0, m.index), b = rest.slice(m.index + m[0].length);
    const pa = planReadLine(a), pb = planReadLine(b);
    if (planHasWork(pa.presc) && planHasWork(pb.presc) && pa.name.length >= 2 && pb.name.length >= 2) {
      parts.push({ text: a, join: false, sep: m[0] });
      rest = b;
    } else break;
  }
  parts.push({ text: rest, join: false });
  // Virgules mises par la reconnaissance vocale avant la prescription (« élévation frontale 3 × 12 Crunch à la poulie,
  // trois séries de 15 ») : coupée seulement aux virgules, la ligne range les noms avec le mauvais exercice. Sans les
  // virgules, le découpage après chaque prescription les remet à leur place
  if (parts.length > 1 && parts.slice(0, -1).every(p => /^\s*,\s*$/.test(p.sep))) {
    const bare = planSplitBare(t.replace(/,/g, ' '));
    const named = bare.map(x => planReadLine(x)).filter(r => planHasWork(r.presc) && r.name.length >= 2).length;
    if (bare.length >= parts.length && named === bare.length && planTrailingName(parts.slice(0, -1))) return bare.map(text => ({ text, join: false }));
  }
  const ssLine = /super\s*-?\s*set|bi\s*-?\s*set|tri\s*-?\s*set/i.test(t);
  parts.forEach((p, i) => { if (i && (/\+|avec|sur|superset|bi-?set|suivi/i.test(parts[i - 1].sep || '') || (ssLine && /\//.test(parts[i - 1].sep || '')))) p.join = true; });
  // Deux prescriptions sans séparateur (dictée) : coupure après la prescription, au premier mot qui n'en fait pas partie
  return parts.flatMap(p => planSplitBare(p.text).map((text, k) => ({ text, join: k ? false : p.join })))
    .flatMap(p => planSplitShared(p, ssLine));
}
// Un morceau qui finit par un nom après sa prescription (« … 3 × 12 Crunch à la poulie ») : le nom est celui du suivant
function planTrailingName(parts) {
  return parts.some(p => {
    const low = planPlain(planDigits(p.text));
    const hits = [...low.matchAll(new RegExp(PARSE_RE.setsReps.source, 'g'))];
    if (!hits.length) return false;
    const h = hits.at(-1), tail = low.slice(h.index + h[0].length).trim().split(/\s+/).filter(w => w && !PARSE_PRESC_WORD.test(w.replace(/[.,;]+$/, '')));
    return tail.length >= 1 && planMatchExercise(tail.join(' ')).score >= PARSE_MATCH_MIN;
  });
}
// « en superset développé couché haltères et écarté poulie quatre séries de dix chacun » : deux exercices nommés, une
// prescription dite une fois pour les deux. Le premier morceau prend la prescription du suivant (share) ; enchaînés si
// la ligne dit superset ou « avec »
const PARSE_SHARED = /\b(?:chacun|chacune|chaque|each|pour les deux|tous les deux|toutes les deux)\b/i;
function planSplitShared(p, ssLine) {
  if (!PARSE_SHARED.test(planPlain(p.text)) && !ssLine) return [p];
  const segs = p.text.split(/\s+(?:et|and|avec|puis)\s+/i);
  if (segs.length < 2 || segs.length > 4) return [p];
  const reads = segs.map(x => planReadLine(x));
  const last = reads.at(-1);
  if (!planHasWork(last.presc) || reads.slice(0, -1).some(r => planHasWork(r.presc) || planMatchExercise(r.name).score < PARSE_MATCH_MIN)) return [p];
  if (planMatchExercise(last.name).score < PARSE_MATCH_MIN) return [p];
  const join = ssLine || /\savec\s/i.test(p.text);
  return segs.map((text, k) => ({ text, join: k ? join : p.join, share: k < segs.length - 1 ? last.presc : null }));
}
// Lecture d'un morceau : sa prescription, complétée par celle qu'il partage avec le suivant
function planPieceRead(piece) {
  const r = planReadLine(piece.text);
  return piece.share ? { ...r, presc: planMergePresc(r.presc, piece.share) } : r;
}
const PARSE_PRESC_WORD = /^(?:un|une|sur|la|le|l|\d+[a-z'"]*|x|fois|series?|séries?|sets?|reps?|repetitions?|répétitions?|de|du|d'|a|à|au|avec|repos|recup|récup|récupération|recuperation|rest|pause|secondes?|sec|s|minutes?|min|mn|kg|kilos?|%|rpe|rir|tempo|par|chaque|bras|jambes?|cote|côté|max|echec|échec|entre|les|et|en|reserve|réserve|drop|set|top|back-?off|rest-pause|cluster|degressif|dégressif|derniere|dernière|toutes|serie|série|\d+-\d+(?:-\d+)*|\(|\)|-|:|,|puis|ensuite|charge|lourd|leger|léger)$/i;
function planSplitBare(text) {
  const low = planPlain(planDigits(text));
  const re = new RegExp(PARSE_RE.setsReps.source, 'g');
  const hits = [...low.matchAll(re)];
  if (hits.length < 2) return [text];
  // Position des coupures dans le texte d'origine : même découpage en mots que la forme simple
  const words = [...planDigits(text).matchAll(/\S+/g)];
  const cuts = [];
  for (let h = 0; h < hits.length - 1; h++) {
    const end = hits[h].index + hits[h][0].length, next = hits[h + 1].index;
    const between = words.filter(w => w.index >= end && w.index < next);
    const firstName = between.find(w => !PARSE_PRESC_WORD.test(planPlain(w[0]).replace(/[.,;]+$/, '')));
    if (firstName) cuts.push(firstName.index);
  }
  if (!cuts.length) return [text];
  const digits = planDigits(text), out = [];
  let last = 0;
  cuts.forEach(c => { out.push(digits.slice(last, c).trim()); last = c; });
  out.push(digits.slice(last).trim());
  return out.filter(Boolean);
}

// ── Analyse ─────────────────────────────────────────────────
// Brouillon : { title, sessions: [{ label, src, items: [item] }], lines: [{ text, role, item? }], stats }
// item : { id, src (ligne source), raw (nom lu), name (fiche ou null), score, how, presc, level, ssKey? }
function planParse(text, { learned = null } = {}) {
  const src = planSourceLines(text);
  // cut : limites atteintes (texte, exercices, séances), dites à l'écran « Vérifier l'import »
  const draft = { title: null, sessions: [], lines: [], notes: [], cut: { text: !!src.cut, items: false, sessions: false } };
  let session = null, skipSection = false, table = null, pendingName = null, ssOpen = null, nItems = 0, seq = 0;
  let block = null, joinNext = false, pendingNote = null;
  const seenHeads = new Set();   // bloc répété en cours (js/data/plan-blocks.js), groupe annoncé par la ligne d'avant
  const lineRec = (txt, role, item = null) => { const r = { text: txt, role }; if (item) r.item = item; draft.lines.push(r); return r; };
  const ensureSession = () => {
    if (!session) { session = { label: '', src: null, items: [] }; draft.sessions.push(session); }
    return session;
  };
  const pushItem = (srcLine, read, m) => {
    if (nItems >= PARSE_MAX_ITEMS) { draft.cut.items = true; return null; }
    const item = { id: `l${++seq}`, src: srcLine, raw: read.name.slice(0, PARSE_NAME_MAX), name: m.name, score: m.score, how: m.how,
      guess: m.guess || null, presc: planBlockApply(read.presc, block), marks: read.marks };
    if (block) block.used = true;
    // « Weighted dips », « Dips lestés » : la fiche est « Dips », le lest reste dans la consigne
    if (PARSE_WEIGHTED.test(read.name) && !/lest|weighted/i.test(m.name || '')) item.presc.weighted = true;
    ensureSession().items.push(item);
    nItems++;
    return item;
  };
  const lastItem = () => session?.items.at(-1) || null;
  // Ligne de groupe (PARSE_GROUP_OPEN, PARSE_GROUP_JOIN) : ouvre le groupe ou relie au suivant ; false sinon
  const planGroupLine = txt => {
    const b = planBare(txt).replace(/[:()]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (PARSE_GROUP_JOIN.test(b)) { joinNext = true; return true; }
    const o = b.match(PARSE_GROUP_OPEN);
    if (!o) return false;
    const rest = b.slice(o[0].length).trim();
    if (rest && planMatchExercise(rest, learned).score >= 0.8) return false;
    if (rest.split(' ').length > 4) return false;
    ssOpen = { key: `g${++seq}`, left: /^tri/.test(b) ? 3 : /^giant/.test(b) ? 5 : 2 };
    return true;
  };

  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    if (!line.trim()) { lineRec(line, 'blank'); table = null; ssOpen = null; if (block?.used) block = null; continue; }
    if (planNoiseLine(line)) { lineRec(line, 'note'); continue; }   // barre d'état, pied de page d'une capture
    // Tableau : en-tête, puis rangées jusqu'à la prochaine ligne vide ou sans colonnes
    const head = planTableHeader(line);
    if (head) {
      table = { ...head, id: ++seq };
      if (pendingNote?.at === i - 1) pendingNote.at = i;   // carte : le nom, l'en-tête des cases, puis les valeurs
      lineRec(line, 'table-head');
      continue;
    }
    let text = line, fromTable = false, tableGroup = null, tableRest = false;
    // Rangée dont les cases de séries et de reps ont des mots, sans chiffre ni « max » : le tableau est fini (fiche en cartes)
    if (table && !table.schedule) {
      const row0 = planRowCells(line, table);
      if (planRowNotDosed(row0) || (row0?.single && planNextIsTableHead(src, i))) table = null;
    }
    if (table) {
      const row = planRowCells(line, table);
      const keys = row ? Object.keys(row).filter(k => row[k] && k !== 'single' && k !== 'num') : [];
      if (row && keys.length && table.schedule) { lineRec(line, 'note'); continue; }   // planning de la semaine
      if (row && keys.length) {
        const dosed = PARSE_TABLE_DOSE.some(k => row[k]);
        // Rangée qui ne porte qu'un nom (ou un nom et un commentaire, sans séries ni reps) : en-tête de séance
        // (« | Jour 1 : Haut | | | »), ligne de groupe (« Superset modifié »), ou nom coupé sur deux lignes
        // (« Développé incliné » puis « haltères  3  10 ») gardé pour la rangée suivante
        if (keys.length === 1 && row.name && planGroupLine(row.name)) { lineRec(line, 'note'); continue; }
        if (row.name && !row.group && !dosed && (keys.length === 1 || table.dosed)) {
          const hr = planReadLine(row.name);
          if (planHeaderOf(row.name, hr)) { text = row.name; table = { ...table, pendingName: null }; }
          else {
            // Fiche de salle : un exercice du catalogue sans prescription (« Pullover », « Presse 31 ») n'est pas un
            // début de nom quand la rangée suivante commence par une majuscule (planTableJoin)
            table.pendingName = table.pendingName ? `${table.pendingName} ${row.name}` : row.name;
            lineRec(line, 'cont');
            continue;
          }
        } else if (!row.name && !row.session && lastItem() && !keys.some(k => k !== 'notes')) { lineRec(line, 'note'); continue; }
        else {
          if (table.pendingName) { row.name = planTableJoin(table.pendingName, row.name || ''); table.pendingName = null; }
          // Colonne « Séance » : une nouvelle séance quand elle est remplie
          if (row.session && planBare(row.session) !== planBare(session?.label || '')) {
            session = { label: planLabel(row.session), src: line, items: [] }; draft.sessions.push(session);
          }
          // Colonne de groupe (« Muscles (superset) ») ou première case vide : la rangée continue le groupe d'avant, et
          // ses cases vides fusionnées (repos) reprennent la valeur du groupe
          if (table.cols.some(c => c.kind === 'group')) {
            const lead = planCells(line).cells[0]?.text;
            if (row.group || !table.grp || lead) table.grp = { key: `t${++seq}`, rest: null };
            if (row.rest) table.grp.rest = row.rest; else if (table.grp.rest) row.rest = table.grp.rest;
            tableGroup = table.grp.key;
          }
          tableRest = !!row.rest;
          text = planRowText(row); fromTable = true;
        }
      } else table = null;
    } else {
      const bare = planBareRow(line);
      if (bare) { text = planRowText(bare); fromTable = true; }
      // Appli : « Lunges	Legs », « Chin-up	Biceps » : la case du groupe musculaire, à droite du nom, n'est pas le nom
      else if (/\t/.test(line)) {
        const cells = line.split('\t');
        if (cells.length === 2 && cells[0].trim() && planSplitOnly(planBare(cells[1])) && planMatchExercise(line, learned).score < 0.85
          && planMatchExercise(cells[0], learned).score >= 0.85) text = cells[0];
        // Fiche en cartes : « CUISSES/FESSIERS	FENTES », l'étiquette du groupe musculaire puis le nom de l'exercice
        else if (cells.length === 2 && /[a-zà-ÿ]{3}/i.test(cells[1]) && planSplitOnly(planBare(cells[0])) && !planHasWork(planReadLine(cells[1]).presc)) text = cells[1];
      }
    }
    const read = planReadLine(text);
    // Ouverture d'un groupe : « Superset : », « Bi-set abdos », « Tri-set » ; « En séries combinées avec » seul
    const bareLine = planBare(text);
    if (!fromTable && !planHasWork(read.presc) && planGroupLine(text)) { lineRec(line, 'note'); continue; }
    // Bloc répété : « 5 rounds », « EMOM 12 », « 2:00 each station » ; il vaut pour les exercices qui suivent
    const blk = fromTable ? null : planBlockOf(text);
    if (blk) {
      block = block && !block.used ? { ...block, ...blk } : blk;
      lineRec(line, 'note');
      continue;
    }
    // « Rest » seul dans un circuit : un poste de repos, pas un jour de repos
    if (block && /^(?:rest|repos|pause|recup(?:eration)?)$/.test(bareLine)) { lineRec(line, 'note'); continue; }
    // Consigne générale (« Repos : 3 à 5 min sur les mouvements de force ») : une note
    if (!fromTable && /^(?:repos|recup|recuperation|rest|pause|note|nb|attention|conseils?|important|objectif|progression|frequence|si\s|ou\s|variante|remplace|alternative|option)\b/.test(bareLine) && !planWorkComplete(read.presc)) {
      lineRec(line, 'note'); draft.notes.push(text.trim()); continue;
    }
    // Date seule (« Date: 5-9-12 », « Mon Tue Wed… Date: Mon 5-14-12 ») : une nouvelle séance d'un carnet
    if (!fromTable && PARSE_DATE_LINE.test(planBare(text)) && !planHasWork(read.presc) && planMatchExercise(read.name, learned).score < PARSE_MATCH_MIN) {
      if (session?.items.length) { session = { label: '', src: line, items: [] }; draft.sessions.push(session); }
      block = null; ssOpen = null; pendingName = null;
      lineRec(line, 'note');
      continue;
    }
    let hd = fromTable ? null : planHeaderOf(text, read);
    // Nom en capitales posé sur l'en-tête de ses cases (« RELEVÉS DE BASSIN » puis « SÉRIES | RÉPÉTITIONS ») : un exercice
    if (hd && !hd.rest && !hd.strong && !planSplitOnly(planBare(text)) && planNextIsTableHead(src, i)) hd = null;
    if (hd) {
      pendingName = null; ssOpen = null; block = null;
      if (hd.rest) { lineRec(line, 'rest-day'); session = null; skipSection = false; continue; }
      const b = planBare(text);
      if (PARSE_SKIP_SECTION_RE.test(b)) { skipSection = true; lineRec(line, 'note'); continue; }
      skipSection = false;
      // « Lundi : DC 4x8, squat 5x5 » : en-tête puis exercices sur la même ligne
      // Sous-titre d'une séance déjà nommée (« JOUR 1 » puis « PECTORAUX », « BICEPS ») : une partie de la séance, pas une
      // nouvelle séance ; sans en-tête fort au-dessus, ces sous-titres restent des séances (« PECTORAUX : », « DOS : »)
      const strong = !!hd.strong;
      if (!strong && session?.strong && planSplitOnly(b)) { lineRec(line, 'note'); continue; }
      // En-tête répété en haut de chaque page d'un PDF (« WORKOUT AT HOME », « TONING WORKOUT: ») : la même séance continue.
      // Pas un en-tête numéroté ni un jour : « Séance A », « Jour 2 » ou « Lundi » qui revient est bien une autre séance
      const hk = planBare(hd.label);
      const indexed = /(?:^|\s)(?:[a-z]|\d+)(?:\s|$)/.test(hk) || new RegExp(`\\b(?:${PARSE_DAYS})\\b`).test(hk);
      if (!indexed && session?.items.length && hk && seenHeads.has(hk)) { lineRec(line, 'note'); continue; }
      if (hk) seenHeads.add(hk);
      if (session && !session.items.length && !session.label) { session.label = hd.label; session.strong = strong; }
      else { session = { label: hd.label, src: line, items: [], strong }; draft.sessions.push(session); }
      session.src = line;
      lineRec(line, 'header');
      continue;
    }
    // Dictée ou ligne sans deux-points : « séance push développé couché 4 fois 10 », « lundi pectoraux développé… »
    const hs = fromTable ? null : planHeadSplit(text, learned, !draft.sessions.some(x => x.items.length) && !session?.label);
    if (hs) {
      session = { label: hs.label, src: line, items: [] }; draft.sessions.push(session); skipSection = false; pendingName = null; ssOpen = null;
      lineRec(line, 'header');
      src.splice(i + 1, 0, hs.rest);
      continue;
    }
    // En-tête suivi d'exercices sur la même ligne : « Lundi (push) : DC 4x8, squat 5x5 »
    const inl = planTidy(text).match(/^([^:]{2,40}):\s*(.+)$/);
    if (inl && !fromTable) {
      const hRead = planReadLine(inl[1]);
      const h2 = planHeaderOf(inl[1], hRead);
      const r2 = planPieceRead(planSplitLine(inl[2])[0]);
      const strong = PARSE_HEAD_RE.test(planBare(inl[1])) || !session?.items.length;
      if (h2 && !h2.rest && strong && planHasWork(r2.presc) && planMatchExercise(r2.name, learned).score >= PARSE_MATCH_MIN) {
        session = { label: h2.label, src: line, items: [] }; draft.sessions.push(session); skipSection = false;
        lineRec(line, 'header');
        src.splice(i + 1, 0, inl[2]);
        continue;
      }
    }
    // « Début de la séance >> 10 minutes d'échauffement cardio » : une consigne d'échauffement, pas un exercice
    if (!fromTable && PARSE_WARMUP_ANY.test(planBare(text)) && read.presc.sets === undefined && planMatchExercise(read.name, learned).score < 0.85) { lineRec(line, 'note'); continue; }
    if (PARSE_SKIP_SECTION_RE.test(planBare(text)) && !planWorkComplete(read.presc)) { lineRec(line, 'note'); if (/:\s*$/.test(text) || planBare(text).split(' ').length <= 2) skipSection = true; continue; }
    if (skipSection) { lineRec(line, 'note'); continue; }
    const pieces = fromTable ? [{ text, join: false }] : planSplitLine(text);
    for (const piece of pieces) {
      const r = piece.text === text && !piece.share ? read : planPieceRead(piece);
      const m = r.name ? planMatchExercise(r.name, learned) : { name: null, score: 0, how: 'none' };
      // Un poste de circuit vaut un exercice, même hors bibliothèque (« Wall Balls ») s'il a l'air d'un nom
      const work = planHasWork(r.presc) || (!!block && !/^\s*[([]/.test(piece.text) && (m.score >= PARSE_MATCH_MIN || (r.name.match(/[a-zà-ÿ]{2,}/gi) || []).length >= 2));
      const prev = lastItem();
      // Correction dictée (« quatre fois dix attends non trois fois dix ») : la nouvelle prescription remplace l'ancienne
      if (work && prev && PARSE_CORRECTION.test(planBare(r.name))) {
        prev.presc = { ...prev.presc, ...r.presc };
        lineRec(line, 'cont', prev);
        continue;
      }
      // Ligne de suite : rien d'un nom, seulement du repos, un tempo, une technique, une charge (« Repos 2 min »)
      if (!m.score && !work && prev && Object.keys(r.presc).length && r.name.split(' ').filter(w => w.length > 2).length <= 2) {
        prev.presc = planMergePresc(prev.presc, r.presc);
        lineRec(line, 'cont', prev);
        continue;
      }
      // Prescription seule sous un nom seul (mode guidé de la dictée, case de tableau sur deux lignes)
      // ou détail d'une appli sous le nom (« Lunges » puis « Barra Completa 2.5kg, 8 reps »)
      const detail = !r.name || (m.score < 0.5 && r.name.split(' ').filter(w => w.length > 2).length <= 1);
      const appDetail = (m.score < PARSE_MATCH_MIN || (m.how === 'fuzzy' && m.score < 0.75)) && r.name.split(' ').length <= 3;
      // (seulement sous une ligne d'appli « nom	groupe musculaire » : ailleurs, un nom inconnu avec sa prescription est un exercice)
      const appLine = /\t/.test(pendingName?.src || '');
      if (work && pendingName && !r.marks.lead && (detail || (appDetail && appLine && pendingName.score >= 0.85 && !Object.keys(pendingName.presc).length))) {
        pendingName.presc = planMergePresc(pendingName.presc, r.presc);
        pendingName = null;
        lineRec(line, 'cont', prev);
        continue;
      }
      // Nom hors bibliothèque sur sa ligne, prescription seule dessous (« Neck Flexion » puis « 5 kg, 15 reps ») : un exercice
      if (work && !pendingName && pendingNote?.at === i - 1 && !r.marks.lead && (detail || appDetail)) {
        const nr = planReadLine(pendingNote.text), item = pushItem(pendingNote.src, { ...nr, presc: planMergePresc(nr.presc, r.presc) }, planMatchExercise(nr.name, learned));
        if (item) {
          Object.assign(pendingNote.rec, { role: 'exercise', item });
          draft.notes.splice(draft.notes.lastIndexOf(pendingNote.text.trim()), 1);
          lineRec(line, 'cont', item);
          pendingNote = null;
          continue;
        }
      }
      // « 1	Pectoraux, biceps et abdos » (planning) : un nombre devant des groupes musculaires n'est pas un exercice
      if (r.marks.lead && planSplitOnly(planBare(r.name)) && r.name.split(/[\s,]+/).length >= 2) { lineRec(line, 'note'); continue; }
      if (!work && m.score < PARSE_MATCH_MIN) {
        // Ni nom ni travail : note (titre du programme si c'est la première ligne)
        if (!draft.title && !draft.sessions.length && planBare(piece.text).length <= 60 && /[a-z]{3}/.test(planBare(piece.text))) { draft.title = planLabel(piece.text); lineRec(line, 'title'); }
        else {
          const rec = lineRec(line, 'note');
          draft.notes.push(piece.text.trim());
          const w = planBare(piece.text).split(' ').filter(x => /[a-z]{2}/.test(x));
          if (pieces.length === 1 && w.length >= 1 && w.length <= 6 && !/[:.]\s*$/.test(piece.text)) pendingNote = { text: r.name || piece.text, src: line, rec, at: i };
        }
        continue;
      }
      const item = pushItem(line, r, m);
      if (!item) break;
      if (piece.join && prev && prev !== item) item.joinPrev = true;
      if (r.marks.plus && prev) item.joinPrev = true;
      if (prev?.marks?.plusAfter) item.joinPrev = true;
      if (/\b(?:avec|and)\s+(?:la\s+)?(?:ligne|exercice|exo)\s+suivant(?:e)?\b|\bwith\s+next\b/i.test(planPlain(r.text))) item.marks = { ...item.marks, plusAfter: true };
      if (fromTable && table?.id) { item.tbl = table.id; item.tblRest = tableRest; }
      if (tableGroup) item.ssKey = tableGroup;
      if (joinNext && prev && prev !== item) item.joinPrev = true;
      joinNext = false;
      if (ssOpen && ssOpen.left > 0) { item.ssKey = ssOpen.key; ssOpen.left--; if (!ssOpen.left) ssOpen = null; }
      pendingName = planHasWork(r.presc) ? null : item;   // un poste de circuit attend encore ses reps (fiche en cartes)
      lineRec(line, 'exercise', item);
    }
  }
  planFinish(draft);
  return draft;
}

// Fin de l'analyse : séances vides retirées, libellés manquants, supersets, niveaux de confiance
function planFinish(draft) {
  // Nom approché sans aucune prescription (« (Push A / Pull A…) » pris pour « Pompes ») : une note, pas un exercice
  // Bloc sans en-tête avant la première séance, fait seulement de noms inconnus (« StrongLifts 5x5 - débutant ») : le titre
  const first = draft.sessions[0];
  if (first && !first.label && draft.sessions.length > 1 && first.items.every(it => !it.name)) {
    first.items.forEach(it => { const l = draft.lines.find(x => x.item === it); if (l) { l.role = draft.title ? 'note' : 'title'; delete l.item; } if (!draft.title) draft.title = planLabel(it.src); });
    first.items = [];
  }
  draft.sessions.forEach(s => {
    s.items = s.items.filter(it => {
      const weak = !Object.keys(it.presc).length && (it.how === 'fuzzy' || it.how === 'none' || /^\s*\(/.test(it.src) || it.raw.split(' ').length > 6);
      if (weak) { const l = draft.lines.find(x => x.item === it); if (l) { l.role = 'note'; delete l.item; } draft.notes.push(it.src.trim()); }
      return !weak;
    });
  });
  draft.sessions = draft.sessions.filter(s => s.items.length);
  if (draft.sessions.length > PARSE_MAX_SESSIONS) { if (draft.cut) draft.cut.sessions = true; draft.sessions = draft.sessions.slice(0, PARSE_MAX_SESSIONS); }
  planTableMergedRest(draft.sessions.flatMap(s => s.items));
  draft.sessions.forEach((s, i) => {
    if (!s.label) s.label = draft.sessions.length > 1 ? `Séance ${String.fromCharCode(65 + i)}` : 'Séance';
    planGroupSupersets(s.items);
    s.items.forEach(planGrade);
  });
  const items = draft.sessions.flatMap(s => s.items);
  draft.stats = { items: items.length, sure: items.filter(x => x.level === 'sure').length, check: items.filter(x => x.level === 'check').length,
    unknown: items.filter(x => x.level === 'unknown').length, sessions: draft.sessions.length };
}
// Groupes de superset d'une séance : A1/A2 (même lettre, à la suite), « + » et « enchaîné avec », « Superset : »
function planGroupSupersets(items) {
  let n = 0, nb = 0;
  const key = () => `s${++n}`;
  planBraceRuns(items, () => `b${++nb}`);
  items.forEach((it, i) => {
    const prev = items[i - 1];
    const letter = it.marks?.ss?.[0];
    if (letter && prev?.marks?.ss?.[0] === letter) it.ss = prev.ss || (prev.ss = key());
    else if (it.joinPrev && prev) it.ss = prev.ss || (prev.ss = key());
    else if (it.ssKey && prev?.ssKey === it.ssKey) it.ss = prev.ss || (prev.ss = key());
  });
  // Lettre seule (« A1 » sans A2) : pas de groupe
  items.forEach(it => { if (it.ss && items.filter(x => x.ss === it.ss).length < 2) delete it.ss; });
}
// Confiance : sûr (nom reconnu et séries × reps lues), à vérifier (nom approché ou prescription incomplète), pas compris
const PARSE_WEIGHTED = /\blest[ée]e?s?\b|\bweighted\b|\bavec\s+(?:du\s+)?lest\b/i;
function planGrade(it) {
  const why = [];
  if (!it.name) why.push('exercice');
  else if (it.score < 0.85) why.push('nom');
  else if (it.how !== 'manual' && it.how !== 'learned' && planEquipMismatch(it.raw, it.name)) why.push('matériel');
  if (!planWorkComplete(it.presc)) why.push(it.presc.sets === undefined ? 'séries' : 'reps');
  it.level = !it.name ? 'unknown' : why.length ? 'check' : 'sure';
  it.why = why;
}

// ── Programme ───────────────────────────────────────────────
// Consigne écrite pour ce que le programme ne porte pas en champ (pourcentage, RPE, RIR, max, par bras, pyramide, durée)
function planConsigne(p) {
  const bits = [];
  if (p.weighted) bits.push('Lesté');
  if (p.pct) bits.push(`${fmtNum(p.pct)} % du max`);
  if (p.rpe) bits.push(`RPE ${fmtNum(p.rpe)}`);
  if (p.rir !== undefined) bits.push(`RIR ${p.rir}`);
  if (p.amrap) bits.push('Max de reps');
  if (p.seconds) bits.push(`${fmtNum(p.seconds)} s par série`);
  if (p.pyramid) bits.push(`Reps ${p.pyramid}`);
  if (p.uni) bits.push('Par bras ou par jambe');
  if (p.meters) bits.push(p.meters >= 1000 ? `${fmtNum(p.meters / 1000)} km` : `${p.meters} m`);
  if (p.every) bits.push(`Une série toutes les ${p.every % 60 ? `${p.every} s` : `${p.every / 60} min`}`);
  return bits.join(' · ');
}
// Exercice du programme pour un élément du brouillon : séries (3 sans indication), reps fixes ou fourchette, repos,
// tempo, charge prescrite, technique, superset
function planExercise(it) {
  const p = it.presc || {};
  const name = (it.name || it.raw || 'Exercice').slice(0, PARSE_NAME_MAX);
  const ex = makeExercise(name, p.sets ? Math.min(PARSE_SETS_MAX, p.sets) : 3);
  if (p.repMax !== undefined) {
    ex.repMax = p.repMax;
    if (p.repMin !== undefined && p.repMin < p.repMax) ex.repMin = p.repMin; else ex.repFixed = true;
  }
  if (p.seconds) ex.measure = 'time';
  if (p.rest > 0) ex.rest = Math.min(PARSE_REST_MAX, Math.max(PARSE_REST_MIN, p.rest));
  if (p.tempo) { const t = parseTempo(p.tempo); if (t) ex.tempo = formatTempo(t); }
  if (p.load) ex.load = p.load;
  if (p.tech) Object.assign(ex, intensFieldsFor(p.tech === 'topback' ? 'topback' : p.tech, p.techWhere === 'all' ? 'all' : 'last', ex.sets));
  const c = planConsigne(p);
  if (c) ex.consigne = c;
  return ex;
}
const PARSE_COLORS = ['var(--orange)', 'var(--indigo)', 'var(--teal)', 'var(--purple)', 'var(--yellow)', 'var(--green)', 'var(--brown)'];
// Programme perso tiré du brouillon : { up (userProgrammes), pd (programmes) }, même forme que genProgrammeData
function planDraftProgramme(draft, name) {
  const sessions = {}, exercises = {}, timers = {}, cooldowns = {}, order = [];
  draft.sessions.filter(s => s.items.some(it => !it.removed)).forEach((s, i) => {
    const key = `imp${i + 1}`;
    order.push(key);
    sessions[key] = { label: (s.label || `Séance ${i + 1}`).slice(0, PARSE_LABEL_MAX), icon: '', desc: '', color: PARSE_COLORS[i % PARSE_COLORS.length] };
    const list = s.items.filter(it => !it.removed);
    const ssIds = new Map();
    exercises[key] = list.map(it => {
      const ex = planExercise(it);
      if (it.ss) { if (!ssIds.has(it.ss)) ssIds.set(it.ss, `i${i + 1}g${ssIds.size + 1}`); ex.ss = ssIds.get(it.ss); }
      return ex;
    });
    timers[key] = null;
    cooldowns[key] = 48;
  });
  return { up: { name: String(name || draft.title || 'Programme importé').slice(0, PARSE_LABEL_MAX), sessions, order, archived: false }, pd: { exercises, timers, cooldowns } };
}
