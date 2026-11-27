// ═══════════════════════════════════════════════════════════
//  Mesure du moteur d'import de programme sur le corpus tests/fixtures/plans/ (docs/IMPORT_PROGRAMME.md)
//  - lecture du corpus (un JSON par plan : texte et vérité attendue) ;
//  - variantes simulées, déterministes : photo bruitée (fautes de lecture typiques d'un OCR) et tableau photographié
//    (morceaux de texte placés, comme Apple Vision les rend) ;
//  - score ligne par ligne : exercice, prescription, séance, superset.
//  Utilisé par tests/unit/plan-import.mjs (seuils) et tools/plan-corpus/mesure.mjs (tableau des chiffres).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

export function loadCorpus(root) {
  const dir = path.join(root, 'tests', 'fixtures', 'plans');
  return fs.readdirSync(dir).filter(f => /^\d{2,3}-.*\.json$/.test(f)).sort()
    .map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

// Générateur pseudo-aléatoire déterministe (mulberry32) : les mêmes fautes à chaque passage
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedOf = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

// Fautes de lecture d'une photo : confusions de formes (o/0, l/1/I, rn/m, é/e, s/5), accents perdus, espaces mangés ou
// ajoutés, ponctuation confondue. rate : part des caractères touchés (0,04 ≈ une photo correcte d'une feuille imprimée)
const SWAP = { o: ['0'], O: ['0'], l: ['1', 'I'], i: ['l', '1'], I: ['l'], e: ['c'], é: ['e', 'è'], è: ['e'], ê: ['e'], à: ['a'], a: ['à', 'o'],
  s: ['5'], S: ['5'], u: ['v'], n: ['h'], c: ['e'], m: ['rn'], x: ['×', 'X'], '×': ['x'], ':': [';', '.'], ',': ['.'], "'": ['’', ''], t: ['f'], h: ['b'] };
export function ocrNoise(text, rate = 0.04, seed = seedOf(text)) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { out += c; continue; }
    // Les chiffres d'une prescription sont mieux lus que les lettres (forme simple) : touchés deux fois moins
    const p = /\d/.test(c) ? rate / 2 : rate;
    if (r() >= p) { out += c; continue; }
    const k = r();
    if (c === ' ' && k < 0.5) continue;                                  // mots collés
    if (k < 0.08) { out += `${c} `; continue; }                           // espace en trop
    if (k < 0.14) continue;                                               // lettre perdue
    if (/[àâäéèêëîïôöùûüç]/i.test(c) && k < 0.7) { out += c.normalize('NFD').replace(/[̀-ͯ]/g, ''); continue; }
    const sw = SWAP[c];
    out += sw ? sw[Math.floor(r() * sw.length)] : c;
  }
  return out;
}

// Tableau photographié : chaque case devient un morceau placé (x selon la colonne, y selon la ligne, légers décalages),
// sa lecture bruitée ; le moteur doit remettre lignes et colonnes en place (planTextFromBoxes)
export function photoBoxes(text, rate = 0.03, seed = seedOf(text)) {
  const r = rng(seed), items = [];
  const lines = text.split('\n');
  const H = 14;
  const split = line => (line.includes('\t') ? line.split('\t') : line.includes('|') ? line.split('|') : line.split(/ {2,}/));
  // Largeur de chaque colonne comme sur une vraie feuille : la case la plus longue, plus une marge
  const widths = [];
  lines.forEach(line => { const c = split(line); if (c.length > 1) c.forEach((t, i) => { widths[i] = Math.max(widths[i] || 0, t.trim().length * 7 + 28); }); });
  const colX = i => 20 + widths.slice(0, i).reduce((a, b) => a + (b || 60), 0);
  lines.forEach((line, li) => {
    if (!line.trim()) return;
    const cells = split(line);
    const y = li * H * 1.6 + (r() - 0.5) * 3;
    cells.forEach((cell, ci) => {
      const t = cell.trim();
      if (!t) return;
      const x = (cells.length === 1 ? 20 : colX(ci)) + (r() - 0.5) * 8;
      // Vision rend souvent une case en un seul morceau, parfois en deux mots séparés
      const words = t.split(' ');
      if (words.length > 2 && r() < 0.3) {
        const cut = Math.ceil(words.length / 2), a = words.slice(0, cut).join(' '), b = words.slice(cut).join(' ');
        items.push({ text: ocrNoise(a, rate, seed + li * 97 + ci), x, y, w: a.length * 7, h: H });
        items.push({ text: ocrNoise(b, rate, seed + li * 89 + ci), x: x + a.length * 7 + 6, y: y + (r() - 0.5) * 2, w: b.length * 7, h: H });
      } else items.push({ text: ocrNoise(t, rate, seed + li * 101 + ci), x, y, w: t.length * 7, h: H });
    });
  });
  // Ordre de lecture rendu par l'OCR : pas forcément celui de la page
  return items.sort(() => r() - 0.5);
}

// ── Score ───────────────────────────────────────────────────
const CORE = ['sets', 'repMin', 'repMax', 'seconds', 'rest', 'amrap'];
const EXTRA = ['load', 'pct', 'rpe', 'rir', 'tempo', 'uni', 'tech', 'techWhere'];
const normTempo = t => String(t ?? '').toUpperCase().split(/[-/ .]/).filter(Boolean).join('-').replace(/-0$/, '');
function prescDiff(exp, got) {
  const bad = [];
  for (const k of CORE) {
    const e = exp[k] ?? (k === 'amrap' ? false : undefined), g = got[k] ?? (k === 'amrap' ? false : undefined);
    if (e !== g) bad.push(`${k}:${e}≠${g}`);
  }
  for (const k of EXTRA) {
    if (exp[k] === undefined) continue;
    const e = k === 'tempo' ? normTempo(exp[k]) : exp[k], g = k === 'tempo' ? normTempo(got[k]) : (k === 'techWhere' ? got[k] ?? (got.tech ? 'last' : undefined) : got[k]);
    if (e !== g) bad.push(`${k}:${e}≠${g}`);
  }
  return bad;
}

// Alignement de la liste attendue et de la liste lue (programmation dynamique : même nom = 2, même prescription = 1)
function align(exp, got) {
  const n = exp.length, m = got.length;
  const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const w = (a, b) => (a.name && a.name === b.name ? 2 : 0) + (a.sets === b.presc.sets && a.repMax === b.presc.repMax ? 1 : 0) + 0.1;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) S[i][j] = Math.max(S[i - 1][j], S[i][j - 1], S[i - 1][j - 1] + w(exp[i - 1], got[j - 1]));
  const pairs = [];
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (S[i][j] === S[i - 1][j - 1] + w(exp[i - 1], got[j - 1])) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (S[i][j] === S[i - 1][j]) i--; else j--;
  }
  return pairs.reverse();
}

// Score d'un plan : lignes attendues justes (exercice, prescription, séance, superset), lignes en trop, détail des erreurs
export function scorePlan(plan, draft) {
  const exp = plan.expected.sessions.flatMap((s, si) => s.exercises.map(e => ({ ...e, si })));
  const got = draft.sessions.flatMap((s, si) => s.items.map(it => ({ ...it, si })));
  const pairs = align(exp, got);
  const byExp = new Map(pairs.map(([i, j]) => [i, j]));
  const usedGot = new Set(pairs.map(([, j]) => j));
  let lines = 0, ok = 0, exOk = 0, prOk = 0;
  const errors = [];
  exp.forEach((e, i) => {
    const j = byExp.get(i);
    if (e.optional) { if (j !== undefined) usedGot.add(j); return; }
    lines++;
    if (j === undefined) { errors.push({ line: e.line, why: ['manquante'] }); return; }
    const g = got[j], why = [];
    const nameOk = e.name ? g.name === e.name : !g.name || g.how === 'learned';
    if (!nameOk) why.push(`nom:${e.name ?? e.raw}≠${g.name ?? `?${g.raw}`}`);
    const pd = prescDiff(e, g.presc);
    why.push(...pd);
    if (!!e.ss !== !!g.ss) why.push(`superset:${e.ss || '-'}≠${g.ss || '-'}`);
    if (e.si !== g.si) why.push(`séance:${e.si}≠${g.si}`);
    if (nameOk) exOk++;
    if (!pd.length) prOk++;
    if (!why.length) ok++; else errors.push({ line: e.line, why });
  });
  const extra = got.filter((_, j) => !usedGot.has(j));
  extra.forEach(g => errors.push({ line: g.src, why: ['en trop'] }));
  return { lines, ok, exOk, prOk, extra: extra.length, sessionsExp: plan.expected.sessions.length, sessionsGot: draft.sessions.length, errors };
}

// Variantes mesurées : le texte tel quel, la photo bruitée des plans propres et libres, le tableau photographié
export function corpusCases(corpus) {
  const cases = [];
  for (const p of corpus) {
    cases.push({ plan: p, kind: p.category, input: { text: p.text } });
    if (p.category === 'propre' || p.category === 'libre') cases.push({ plan: p, kind: 'photo', input: { text: ocrNoise(p.text) } });
    if (p.category === 'tableau') cases.push({ plan: p, kind: 'photo-tableau', input: { boxes: photoBoxes(p.text) } });
  }
  return cases;
}

export function measure(corpus, parse) {
  const by = {};
  const details = [];
  for (const c of corpusCases(corpus)) {
    const draft = parse(c.input);
    const s = scorePlan(c.plan, draft);
    const b = (by[c.kind] ||= { plans: 0, lines: 0, ok: 0, exOk: 0, prOk: 0, extra: 0, sessionsOk: 0 });
    b.plans++; b.lines += s.lines; b.ok += s.ok; b.exOk += s.exOk; b.prOk += s.prOk; b.extra += s.extra;
    if (s.sessionsExp === s.sessionsGot) b.sessionsOk++;
    details.push({ id: c.plan.id, kind: c.kind, ...s });
  }
  for (const b of Object.values(by)) {
    b.lineRate = b.ok / Math.max(1, b.lines + b.extra);
    b.exRate = b.exOk / Math.max(1, b.lines);
    b.prRate = b.prOk / Math.max(1, b.lines);
  }
  return { by, details };
}
