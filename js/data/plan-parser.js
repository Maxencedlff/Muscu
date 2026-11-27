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
  'triceps|fessiers|fessier|cuisses|ischios|quadriceps|quads|abdos|abdominaux|cardio|torse|poitrine|chest|back|shoulders|arms|glutes|tirage|poussee|pousser|' +
  'tirer|force|hypertrophie|puissance|power|strength|mollets|trapezes|avant|arriere|posterieur|anterieure|anterieur|chaine|et|and|day|jour|a|b|c|d|1|2|3|4|5|6|7|' +
  'seance|session|workout|entrainement|training|semaine|week|split|ppl|phul|phat|lourd|leger|heavy|light|volume|intensite|technique|accessoires|' +
  'complet|core|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|semaine|suivante|premiere|deuxieme|troisieme|quatrieme|derniere|1re|2e|3e|4e').split('|'));
const PARSE_HEAD_RE = new RegExp(`^(?:(?:${PARSE_DAYS})\\b|(?:seance|session|workout|entrainement|training)\\b|(?:jour|day|j|bloc)\\s*(?:n°|no|#)?\\s*[a-z0-9]{1,3}\\b|(?:premiere|deuxieme|troisieme|quatrieme|cinquieme|sixieme|1re|2e|3e|4e|5e|6e|1ere|2eme|3eme|4eme|5eme)\\s+seance\\b|seance\\s+(?:suivante|du|de|des|d')\\b)`);
const PARSE_REST_DAY_RE = new RegExp(`^(?:(?:${PARSE_DAYS}|jour\\s*\\d+|day\\s*\\d+|j\\s*\\d+)\\s*[:\\-]?\\s*)?(?:repos|off|rest|recuperation|recup|repos complet|repos actif|jour de repos|rest day|day off)(?:\\s+(?:complet|actif|total))?\\s*[.!]*$`);
const PARSE_SKIP_SECTION_RE = /^(?:echauffement|echauffements|warm\s*-?\s*up|retour au calme|cool\s*-?\s*down|etirements?|stretching|mobilite|notes?|conseils?|remarques?|important|nutrition|alimentation)\b/;
// Mots qui recoupent une dictée (pas de retour à la ligne) : un nouvel exercice ou une nouvelle séance commence
const PARSE_DICT_BREAK = /\s+(?=(?:ensuite|puis|apres ca|apres|et pour finir|pour finir|on termine|on enchaine|on finit|enfin|exercice suivant|dernier exercice|et on finit|on passe a)\b)/gi;
const PARSE_DICT_SESSION = new RegExp(`\\s+(?=(?:(?:premiere|deuxieme|troisieme|quatrieme|cinquieme|1re|2e|3e|4e)\\s+seance|seance\\s+(?:suivante|[a-z0-9]{1,3}\\b|push|pull|jambes|legs|haut|bas)|jour\\s+\\d|(?:${PARSE_DAYS})\\b))`, 'gi');

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
  if (PARSE_HEAD_RE.test(b) && words.length <= 9) return { label };
  if (words.length <= 6 && words.every(w => PARSE_SPLIT_WORDS.has(w))) return { label };
  // « PUSH », « JAMBES / FESSIERS » en capitales, ou une ligne courte finie par « : » qui n'est pas un exercice
  const letters = planTidy(line).replace(/[^A-Za-zÀ-ÿ]/g, '');
  const caps = letters.length >= 3 && letters === letters.toUpperCase();
  if ((caps || /:\s*$/.test(line)) && words.length <= 5) {
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

// En-tête collé à son premier exercice, sans deux-points : mots de séance en tête (« séance suivante jambes »), puis un
// exercice reconnu qui prescrit un travail. { label, rest } ou null
function planHeadSplit(text, learned) {
  const t = planTidy(text);
  const low = planPlain(t);
  if (!PARSE_HEAD_RE.test(low) && !new RegExp(`^(?:${PARSE_DAYS})\\b`).test(low)) return null;
  const words = [...t.matchAll(/\S+/g)];
  let k = 0;
  while (k < words.length && k < 6 && PARSE_SPLIT_WORDS.has(planPlain(words[k][0]).replace(/[^a-z0-9]/g, ''))) k++;
  if (!k || k >= words.length) return null;
  const rest = t.slice(words[k].index);
  const r = planReadLine(planSplitLine(rest)[0].text);
  if (!planHasWork(r.presc) || planMatchExercise(r.name, learned).score < PARSE_MATCH_MIN) return null;
  return { label: planLabel(t.slice(0, words[k].index)), rest };
}

// ── Découpage ────────────────────────────────────────────────
// Lignes du texte, une dictée recoupée ; chaque ligne garde son texte source pour l'écran de vérification
function planSourceLines(text) {
  let s = planTidy(String(text ?? '').slice(0, PARSE_MAX_CHARS)).replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  const long = lines.filter(l => l.length > 160);
  // Dictée ou paragraphe : coupé aux mots de passage et aux séances, en gardant la phrase source
  if (long.length) {
    s = lines.map(l => (l.length > 160 || (lines.length <= 3 && l.length > 80) ? planPlainSafe(l) : l)).join('\n');
  }
  const all = s.split('\n'), out = all.slice(0, PARSE_MAX_LINES);
  out.cut = all.length > PARSE_MAX_LINES || String(text ?? '').length > PARSE_MAX_CHARS;   // texte coupé : dit à l'écran
  return out;
}
// Coupe sur une copie sans accents mais garde le texte d'origine : on repère les positions sur la forme simple
function planPlainSafe(l) {
  const low = planPlain(l);
  const cuts = new Set();
  for (const re of [PARSE_DICT_SESSION, PARSE_DICT_BREAK, /\s*[.;]\s+(?=\S)/g]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(low))) { cuts.add(m.index); if (m[0] === '') re.lastIndex++; }
  }
  let out = '', last = 0;
  [...cuts].sort((a, b) => a - b).forEach(i => { out += `${l.slice(last, i).trimEnd()}\n`; last = i; });
  return (out + l.slice(last)).replace(/\n\s*[.;]\s*/g, '\n').replace(/^\s+/gm, '');
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
  const ssLine = /super\s*-?\s*set|bi\s*-?\s*set|tri\s*-?\s*set/i.test(t);
  parts.forEach((p, i) => { if (i && (/\+|avec|sur|superset|bi-?set|suivi/i.test(parts[i - 1].sep || '') || (ssLine && /\//.test(parts[i - 1].sep || '')))) p.join = true; });
  // Deux prescriptions sans séparateur (dictée) : coupure après la prescription, au premier mot qui n'en fait pas partie
  return parts.flatMap(p => planSplitBare(p.text).map((text, k) => ({ text, join: k ? false : p.join })));
}
const PARSE_PRESC_WORD = /^(?:\d+[a-z'"]*|x|fois|series?|séries?|sets?|reps?|repetitions?|répétitions?|de|du|d'|a|à|au|avec|repos|recup|récup|récupération|recuperation|rest|pause|secondes?|sec|s|minutes?|min|mn|kg|kilos?|%|rpe|rir|tempo|par|chaque|bras|jambes?|cote|côté|max|echec|échec|entre|les|et|en|reserve|réserve|drop|set|top|back-?off|rest-pause|cluster|degressif|dégressif|derniere|dernière|toutes|serie|série|\d+-\d+(?:-\d+)*|\(|\)|-|:|,|puis|ensuite|charge|lourd|leger|léger)$/i;
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
  const lineRec = (txt, role, item = null) => { const r = { text: txt, role }; if (item) r.item = item; draft.lines.push(r); return r; };
  const ensureSession = () => {
    if (!session) { session = { label: '', src: null, items: [] }; draft.sessions.push(session); }
    return session;
  };
  const pushItem = (srcLine, read, m) => {
    if (nItems >= PARSE_MAX_ITEMS) { draft.cut.items = true; return null; }
    const item = { id: `l${++seq}`, src: srcLine, raw: read.name.slice(0, PARSE_NAME_MAX), name: m.name, score: m.score, how: m.how,
      guess: m.guess || null, presc: { ...read.presc }, marks: read.marks };
    // « Weighted dips », « Dips lestés » : la fiche est « Dips », le lest reste dans la consigne
    if (PARSE_WEIGHTED.test(read.name) && !/lest|weighted/i.test(m.name || '')) item.presc.weighted = true;
    ensureSession().items.push(item);
    nItems++;
    return item;
  };
  const lastItem = () => session?.items.at(-1) || null;

  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    if (!line.trim()) { lineRec(line, 'blank'); table = null; ssOpen = null; continue; }
    // Tableau : en-tête, puis rangées jusqu'à la prochaine ligne vide ou sans colonnes
    const head = planTableHeader(line);
    if (head) { table = head; lineRec(line, 'table-head'); continue; }
    let text = line, fromTable = false;
    if (table) {
      const row = planRowCells(line, table);
      const keys = row ? Object.keys(row).filter(k => row[k] && k !== 'single') : [];
      if (row && keys.length) {
        // Rangée qui ne porte qu'un nom : en-tête de séance (« | Jour 1 : Haut | | | »), ou nom coupé sur deux lignes
        // (« Développé incliné » puis « haltères  3  10 ») gardé pour la rangée suivante
        if (keys.length === 1 && row.name) {
          const hr = planReadLine(row.name);
          if (planHeaderOf(row.name, hr)) { text = row.name; table = { ...table, pendingName: null }; }
          else { table.pendingName = table.pendingName ? `${table.pendingName} ${row.name}` : row.name; lineRec(line, 'cont'); continue; }
        } else if (!row.name && !row.session && lastItem() && !keys.some(k => k !== 'notes')) { lineRec(line, 'note'); continue; }
        else {
          if (table.pendingName) { row.name = `${table.pendingName} ${row.name || ''}`.trim(); table.pendingName = null; }
          // Colonne « Séance » : une nouvelle séance quand elle est remplie
          if (row.session && planBare(row.session) !== planBare(session?.label || '')) {
            session = { label: planLabel(row.session), src: line, items: [] }; draft.sessions.push(session);
          }
          text = planRowText(row); fromTable = true;
        }
      } else table = null;
    } else {
      const bare = planBareRow(line);
      if (bare) { text = planRowText(bare); fromTable = true; }
    }
    const read = planReadLine(text);
    // Ouverture d'un groupe : « Superset : », « Bi-set », « Tri-set », « Circuit » seuls sur la ligne
    const bareLine = planBare(text);
    const opener = bareLine.match(/^(?:super\s*-?\s*set|superset|bi\s*-?\s*set|tri\s*-?\s*set|giant\s*set)\s*(?:[a-z0-9]{1,2})?\s*:?\s*(?:\(.*\))?$/);
    if (opener && !planHasWork(read.presc) && !fromTable) {
      ssOpen = { key: `g${++seq}`, left: /tri/.test(bareLine) ? 3 : /giant/.test(bareLine) ? 5 : 2 };
      lineRec(line, 'note');
      continue;
    }
    // Consigne générale (« Repos : 3 à 5 min sur les mouvements de force ») : une note
    if (!fromTable && /^(?:repos|recup|recuperation|rest|pause|note|nb|attention|conseils?|important|objectif|progression|frequence|si\s|ou\s|variante|remplace|alternative|option)\b/.test(bareLine) && !planWorkComplete(read.presc)) {
      lineRec(line, 'note'); draft.notes.push(text.trim()); continue;
    }
    const hd = fromTable ? null : planHeaderOf(text, read);
    if (hd) {
      pendingName = null; ssOpen = null;
      if (hd.rest) { lineRec(line, 'rest-day'); session = null; skipSection = false; continue; }
      const b = planBare(text);
      if (PARSE_SKIP_SECTION_RE.test(b)) { skipSection = true; lineRec(line, 'note'); continue; }
      skipSection = false;
      // « Lundi : DC 4x8, squat 5x5 » : en-tête puis exercices sur la même ligne
      if (session && !session.items.length && !session.label) session.label = hd.label;
      else { session = { label: hd.label, src: line, items: [] }; draft.sessions.push(session); }
      session.src = line;
      lineRec(line, 'header');
      continue;
    }
    // Dictée ou ligne sans deux-points : « séance push développé couché 4 fois 10 », « lundi pectoraux développé… »
    const hs = fromTable ? null : planHeadSplit(text, learned);
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
      const r2 = planReadLine(planSplitLine(inl[2])[0].text);
      const strong = PARSE_HEAD_RE.test(planBare(inl[1])) || !session?.items.length;
      if (h2 && !h2.rest && strong && planHasWork(r2.presc) && planMatchExercise(r2.name, learned).score >= PARSE_MATCH_MIN) {
        session = { label: h2.label, src: line, items: [] }; draft.sessions.push(session); skipSection = false;
        lineRec(line, 'header');
        src.splice(i + 1, 0, inl[2]);
        continue;
      }
    }
    if (PARSE_SKIP_SECTION_RE.test(planBare(text)) && !planWorkComplete(read.presc)) { lineRec(line, 'note'); if (/:\s*$/.test(text) || planBare(text).split(' ').length <= 2) skipSection = true; continue; }
    if (skipSection) { lineRec(line, 'note'); continue; }
    const pieces = fromTable ? [{ text, join: false }] : planSplitLine(text);
    for (const piece of pieces) {
      const r = piece.text === text ? read : planReadLine(piece.text);
      const m = r.name ? planMatchExercise(r.name, learned) : { name: null, score: 0, how: 'none' };
      const work = planHasWork(r.presc);
      const prev = lastItem();
      // Ligne de suite : rien d'un nom, seulement du repos, un tempo, une technique, une charge (« Repos 2 min »)
      if (!m.score && !work && prev && Object.keys(r.presc).length && r.name.split(' ').filter(w => w.length > 2).length <= 2) {
        prev.presc = planMergePresc(prev.presc, r.presc);
        lineRec(line, 'cont', prev);
        continue;
      }
      // Prescription seule sous un nom seul (mode guidé de la dictée, case de tableau sur deux lignes)
      if (work && (!r.name || m.score < 0.5) && pendingName) {
        pendingName.presc = planMergePresc(pendingName.presc, r.presc);
        pendingName = null;
        lineRec(line, 'cont', prev);
        continue;
      }
      if (!work && m.score < PARSE_MATCH_MIN) {
        // Ni nom ni travail : note (titre du programme si c'est la première ligne)
        if (!draft.title && !draft.sessions.length && planBare(piece.text).length <= 60 && /[a-z]{3}/.test(planBare(piece.text))) { draft.title = planLabel(piece.text); lineRec(line, 'title'); }
        else { lineRec(line, 'note'); draft.notes.push(piece.text.trim()); }
        continue;
      }
      const item = pushItem(line, r, m);
      if (!item) break;
      if (piece.join && prev && prev !== item) item.joinPrev = true;
      if (r.marks.plus && prev) item.joinPrev = true;
      if (prev?.marks?.plusAfter) item.joinPrev = true;
      if (/\b(?:avec|and)\s+(?:la\s+)?(?:ligne|exercice|exo)\s+suivant(?:e)?\b|\bwith\s+next\b/i.test(planPlain(r.text))) item.marks = { ...item.marks, plusAfter: true };
      if (ssOpen && ssOpen.left > 0) { item.ssKey = ssOpen.key; ssOpen.left--; if (!ssOpen.left) ssOpen = null; }
      pendingName = work ? null : item;
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
  let n = 0;
  const key = () => `s${++n}`;
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
