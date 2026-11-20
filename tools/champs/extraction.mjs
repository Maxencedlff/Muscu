// ═══════════════════════════════════════════════════════════
//  Inventaire des champs : extraction sans navigateur (logique pure, testée dans tests/unit/champs.mjs)
//
//  - champsDuCode(fichiers) : chaque champ de saisie écrit dans js/ : balises <input> et <textarea> des gabarits,
//    document.createElement('input'), [contenteditable], et les champs des dialogues (dialog({ input }), askText,
//    askNumber, askNote, askProfileNumber, coachTextSheet). Pour chacun : clé stable, fichier:ligne, attributs.
//  - constantesDu(fichiers) : valeur des constantes en majuscules (« const PLAN_NAME_MAX = 40 ») pour résoudre
//    maxlength="${PLAN_NAME_MAX}" et les bornes du registre.
//  - bornesSql(migrations, cible) : bornes du serveur lues dans supabase/migrations (dernière définition gagnante).
// ═══════════════════════════════════════════════════════════
import vm from 'node:vm';

const ligneDe = (src, i) => src.slice(0, i).split('\n').length;

// Texte d'une balise depuis « <input » jusqu'à son « > », sans s'arrêter sur un « > » d'une expression ${…}
function texteBalise(src, debut) {
  let prof = 0, out = '';
  for (let i = debut; i < src.length; i++) {
    const c = src[i];
    if (c === '$' && src[i + 1] === '{') { prof++; out += '${'; i++; continue; }
    if (prof && c === '{') prof++;
    if (prof && c === '}') { prof--; out += '}'; continue; }
    if (!prof && c === '>') return out;
    out += c;
  }
  return out;
}

// Attributs d'une balise. Une expression ${…} hors de guillemets (« ${attrs} », « ${next ? 'disabled' : ''} ») est
// gardée dans `dyn` ; une valeur « ${CONST} » est résolue par l'appelant
function attributs(balise) {
  const dyn = [];
  const sans = balise.replace(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g, (m, e, off) => {
    // Dans des guillemets ? On regarde le nombre de " avant l'expression
    const avant = balise.slice(0, off).replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
    if ((avant.match(/"/g) || []).length % 2 === 1) return `§{${e}}§`;
    dyn.push(e.trim());
    return ' ';
  });
  const a = {};
  for (const m of sans.matchAll(/([a-zA-Z][\w:-]*)(?:\s*=\s*"([^"]*)")?/g)) {
    const nom = m[1].toLowerCase();
    if (nom === 'input' || nom === 'textarea') continue;
    if (!(nom in a)) a[nom] = m[2] === undefined ? true : m[2].replace(/§\{([\s\S]*?)\}§/g, '${$1}');
  }
  return { a, dyn };
}

// Valeur d'un objet littéral « input: { value, placeholder, text: true, max: NOTE_MAX } » d'un appel de dialogue
function clesObjet(txt) {
  const o = {};
  for (const m of txt.matchAll(/(?:^|[{,])\s*(\w+)(?:\s*:\s*([^,}]+))?/g)) o[m[1]] = m[2] === undefined ? true : m[2].trim();
  return o;
}

// Bloc entre parenthèses équilibrées à partir de src[i] === '('
function blocParentheses(src, i) {
  let prof = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '(') prof++;
    else if (src[j] === ')' && --prof === 0) return src.slice(i + 1, j);
  }
  return src.slice(i + 1);
}

const titreDe = txt => {
  const m = txt.match(/title\s*:\s*('([^']*)'|"([^"]*)"|`([^`]*)`|[^,]+)/);
  return m ? (m[2] ?? m[3] ?? m[4] ?? m[1]).trim() : '';
};

// Champ des dialogues (js/core/dialogs.js) : les branches du gabarit « input.digits ? '…' : input.text ? `…` :
// input.decimal ? '…' : '…' », lues dans le code (jamais recopiées ici : un changement du gabarit change l'inventaire)
export function branchesDialogue(src) {
  const i = src.indexOf('ios-dialog__input');
  const bloc = i < 0 ? '' : src.slice(i, src.indexOf('value=', i));
  const q = "(?:'([^']*)'|`([^`]*)`)";
  const pris = {};
  for (const k of ['digits', 'text', 'decimal']) {
    const m = bloc.match(new RegExp(`input\\.${k}\\s*\\?\\s*${q}`));
    if (m) pris[k] = m[1] ?? m[2];
  }
  const fin = bloc.match(new RegExp(`:\\s*${q}\\s*\\}?\\s*$`, 's')) || bloc.match(new RegExp(`:\\s*${q}\\s*\\}`, 's'));
  const all = [...bloc.matchAll(new RegExp(`:\\s*${q}`, 'g'))];
  pris.autre = all.length ? (all[all.length - 1][1] ?? all[all.length - 1][2]) : (fin ? fin[1] ?? fin[2] : '');
  return pris;
}

// Attributs du champ d'un dialog({ input }) d'après les branches du gabarit ; max : « ${input.max || 40} »
function attributsDialogue(o, branches) {
  const k = o.digits ? 'digits' : o.text ? 'text' : o.decimal ? 'decimal' : 'autre';
  const brut = (branches[k] ?? '').replace(/\$\{input\.max\s*\|\|\s*(\d+)\}/, (m, d) => (o.max ?? d));
  const { a } = attributs(brut);
  a.type ??= 'text';
  return { ...a, aide: 'dialog' };
}

// Appels des aides de dialogue à champ (js/core/dialogs.js, js/features/settings.js, session-notes.js, coach-ui.js) :
// les options passées à dialog({ input }) par chaque aide
const AIDES = {
  askText:          o => ({ input: { text: true, max: o.max }, aide: 'askText' }),
  askNumber:        o => ({ input: { decimal: o.decimal }, aide: 'askNumber' }),
  askProfileNumber: () => ({ input: {}, aide: 'askProfileNumber' }),
  askNote:          () => ({ input: { text: true, max: 'NOTE_MAX' }, aide: 'askNote' }),
  coachTextSheet:   o => ({ a: { type: 'textarea', maxlength: o.max ?? 'COACH_NOTE_MAX' }, aide: 'coachTextSheet' }),
};

// Champs du code. fichiers : [{ chemin: 'js/…', src }]
export function champsDuCode(fichiers) {
  const out = [];
  const branches = branchesDialogue(fichiers.find(f => f.chemin === 'js/core/dialogs.js')?.src ?? '');
  for (const { chemin, src } of fichiers) {
    const court = chemin.replace(/^js\//, '');
    const vus = new Map();
    const pousse = (cle, ligne, a, extra = {}, parId = false) => {
      // Même clé deux fois dans un fichier : le même champ dessiné à deux endroits (#exRepMax en Fixe et en Fourchette)
      // s'il a un id fixe, sinon un champ différent numéroté dans l'ordre (~2, ~3)
      const prev = vus.get(cle);
      if (prev && !parId) {
        let n = 2;
        while (vus.has(`${cle}~${n}`)) n++;
        cle = `${cle}~${n}`;
      } else if (prev) { prev.lignes.push(ligne); return; }
      const c = { cle, fichier: chemin, ligne, lignes: [ligne], a, ...extra };
      vus.set(cle, c); out.push(c);
    };
    // Commentaires retirés (mêmes longueurs : les numéros de ligne restent justes)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
    for (const m of code.matchAll(/<(input|textarea)\b/g)) {
      if (court === 'core/dialogs.js') continue;   // gabarit du champ des dialogues : chaque appel est inventorié
      const { a, dyn } = attributs(texteBalise(code, m.index + 1));
      if (m[1] === 'textarea') a.type = 'textarea';
      a.type ??= 'text';
      const parId = !!a.id && !a.id.includes('${');
      const ident = parId ? a.id : a['data-action'] && !a['data-action'].includes('${') ? a['data-action']
        : (a.class || '').split(/\s+/).find(c => c && !c.includes('${')) || m[1];
      pousse(`${court}#${ident}`, ligneDe(code, m.index), a, { dyn }, parId);
    }
    for (const m of code.matchAll(/(\w+)\s*=\s*document\.createElement\(\s*['"](input|textarea)['"]\s*\)/g)) {
      const v = m[1], suite = code.slice(m.index, m.index + 600);
      const a = { type: m[2] === 'textarea' ? 'textarea' : 'text' };
      const t = suite.match(new RegExp(`${v}\\.type\\s*=\\s*'(\\w+)'|type\\s*:\\s*'(\\w+)'`));
      if (t) a.type = t[1] || t[2];
      const ml = suite.match(/maxLength\s*[:=]\s*([\w.]+)/); if (ml) a.maxlength = ml[1];
      const im = suite.match(/inputMode\s*:\s*([^,}]+)/); if (im) a.inputmode = im[1].trim();
      const id = suite.match(/id\s*:\s*'([\w-]+)'/);
      pousse(`${court}:createElement:${id ? id[1] : a.type}`, ligneDe(code, m.index), a);
    }
    for (const m of code.matchAll(/(?<!\[)contenteditable\s*=\s*"(?:true|plaintext-only)"/g)) {
      pousse(`${court}:contenteditable`, ligneDe(code, m.index), { type: 'contenteditable' });
    }
    // dialog({ … input: { … } … })
    for (const m of code.matchAll(/\bdialog\(\s*\{/g)) {
      const args = blocParentheses(code, m.index + 'dialog'.length);
      const im = args.match(/input\s*:\s*\{([^{}]*)\}/);
      if (!im || court === 'core/dialogs.js') continue;
      const o = clesObjet(im[1]);
      pousse(`${court}:dialog:${titreDe(args)}`, ligneDe(code, m.index), attributsDialogue(o, branches));
    }
    for (const [nom, attrs] of Object.entries(AIDES)) {
      for (const m of code.matchAll(new RegExp(`(?<![\\w.])${nom}\\(\\s*\\{`, 'g'))) {
        if (/function\s+$/.test(code.slice(Math.max(0, m.index - 40), m.index))) continue;   // la définition
        const args = blocParentheses(code, m.index + nom.length);
        // Options de premier niveau seulement : l'objet passé, sans ses objets imbriqués ni ses ${…}
        const t = args.trim(), dedans = t.startsWith('{') ? t.slice(1, t.lastIndexOf('}')) : t;
        const d = attrs(clesObjet(dedans.replace(/\$?\{[^{}]*\}/g, '0')));
        pousse(`${court}:${nom}:${titreDe(args)}`, ligneDe(code, m.index), { ...(d.a || attributsDialogue(d.input, branches)), aide: d.aide });
      }
    }
  }
  return out;
}

// ── Constantes ──────────────────────────────────────────────

// Déclarations « const NOM = … ; » au niveau du fichier (plusieurs par ligne possibles), évaluées dans un contexte
// isolé qui ne connaît que les constantes déjà lues : une valeur qui appelle une fonction de l'app reste inconnue
export function constantesDu(fichiers) {
  const ctx = vm.createContext({});
  const vals = {};
  for (const { src } of fichiers) {
    for (const m of src.matchAll(/^(?:const|let)\s+(?=[A-Z])/gm)) {
      let i = m.index + m[0].length, prof = 0, q = null, decl = '';
      for (; i < src.length; i++) {
        const c = src[i];
        if (q) { decl += c; if (c === q && src[i - 1] !== '\\') q = null; continue; }
        if (c === "'" || c === '"' || c === '`') { q = c; decl += c; continue; }
        if ('([{'.includes(c)) prof++;
        if (')]}'.includes(c)) prof--;
        if (!prof && (c === ';' || (c === '\n' && !/[,=([{+\-*/?:]\s*$/.test(decl) && !/^\s*[.?:+\-*/]/.test(src.slice(i + 1, i + 40))))) break;
        decl += c;
      }
      // Découpe aux virgules de premier niveau : « USERNAME_MIN = 3, USERNAME_MAX = 20 »
      const parts = []; let cur = ''; prof = 0; q = null;
      for (const c of decl) {
        if (q) { cur += c; if (c === q) q = null; continue; }
        if (c === "'" || c === '"' || c === '`') q = c;
        if ('([{'.includes(c)) prof++;
        if (')]}'.includes(c)) prof--;
        if (c === ',' && !prof) { parts.push(cur); cur = ''; continue; }
        cur += c;
      }
      parts.push(cur);
      for (const p of parts) {
        const d = p.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*([\s\S]+)$/);
        if (!d) continue;
        try {
          const v = vm.runInContext(`(${d[2]})`, ctx, { timeout: 50 });
          ctx[d[1]] = v; vals[d[1]] = v;
        } catch { /* valeur calculée par l'app : inconnue ici */ }
      }
    }
  }
  return vals;
}

// « 40 », « ${PLAN_NAME_MAX} », « DIET_TARGET_MAX.kcal », « DIET_SALT_T[1] », « ${input.max || 40} » → nombre ou null
export function resoudre(v, consts) {
  if (v === undefined || v === null || v === true) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/^\$\{([\s\S]*)\}$/, '$1').trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Calcul simple sur des constantes : « OTP_LENGTH + 4 »
  if (/^[A-Z0-9_\s+\-*/().]+$/.test(s) && /[+\-*/]/.test(s)) {
    const t = s.replace(/[A-Z][A-Z0-9_]*/g, k => (typeof consts[k] === 'number' ? String(consts[k]) : 'NaN'));
    const v = /^[\d\s+\-*/().NaN]+$/.test(t) ? Function(`return (${t})`)() : NaN;
    return Number.isFinite(v) ? v : null;
  }
  const m = s.match(/^([A-Z][A-Z0-9_]*)((?:\.\w+|\[\d+\])*)$/);
  if (!m || !(m[1] in consts)) return null;
  let x = consts[m[1]];
  for (const k of m[2].match(/\.\w+|\[\d+\]/g) || []) x = x?.[k.startsWith('.') ? k.slice(1) : Number(k.slice(1, -1))];
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

// ── Bornes du serveur (supabase/migrations) ─────────────────

// Bornes d'une expression SQL sur `nom` : longueur (char_length), motif (~ '^…{a,b}$'), nombre (between, <=)
export function bornesExpression(expr, nom) {
  const n = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = {};
  const len = `(?:char_length|length)\\(\\s*(?:btrim\\(\\s*)?(?:\\w+\\.)?${n}\\s*\\)?\\s*\\)`;
  let m;
  if ((m = expr.match(new RegExp(`${len}\\s+(not\\s+)?between\\s+(\\d+)\\s+and\\s+(\\d+)`, 'i')))) { out.longMin = +m[2]; out.longMax = +m[3]; }
  else if ((m = expr.match(new RegExp(`${len}\\s*(<=|<|>)\\s*(\\d+)`, 'i')))) out.longMax = m[1] === '<' ? +m[2] - 1 : +m[2];
  // Motifs « col ~ '^…{a,b}$' » : plusieurs possibles (« code ~ '^…{8}$' or (permanent and code ~ '^…{12}$') ») ;
  // longueur de chaque alternative : parties fixes + quantificateurs, la plus courte et la plus longue gardées
  const motifs = [...expr.matchAll(new RegExp(`(?:\\w+\\.)?${n}\\s*!?~\\s*'\\^([^']*)\\$'`, 'g'))].map(x => x[1]);
  if (motifs.length) {
    out.motif = motifs.join(' | ');
    const bornes = motifs.flatMap(mo => mo.split('|')).map(alt => {
      const qq = [...alt.matchAll(/(\[[^\]]*\]|\\.|[^[\\{}()])\{(\d+)(?:,(\d+))?\}/g)];
      const fixe = alt.replace(/(\[[^\]]*\]|\\.|[^[\\{}()])\{\d+(?:,\d+)?\}/g, '').replace(/\[[^\]]*\]|\\./g, 'x').replace(/[()^$?:]/g, '').length;
      return [fixe + qq.reduce((t, x) => t + +x[2], 0), fixe + qq.reduce((t, x) => t + +(x[3] ?? x[2]), 0)];
    });
    out.longMin = Math.min(...bornes.map(b => b[0])); out.longMax = Math.max(...bornes.map(b => b[1]));
  }
  if ((m = expr.match(new RegExp(`(?:\\(\\s*\\w+\\s*->>\\s*)?(?<![\\w.])${n}(?:\\)::numeric)?\\s+between\\s+(-?[\\d.]+)\\s+and\\s+(-?[\\d.]+)`, 'i')))) { out.min = +m[1]; out.max = +m[2]; }
  // Aides « private.diet_num_ok(v -> 'salt', 0, 100, true) »
  if ((m = expr.match(new RegExp(`_ok\\(\\s*v\\s*->\\s*'${n}'\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)`)))) { out.min = +m[1]; out.max = +m[2]; }
  return out;
}

// Corps de la DERNIÈRE définition d'une fonction (create [or replace] function schema.nom(…) … $$ … $$)
function corpsFonction(migrations, nom) {
  let corps = null, ou = null;
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${nom.replace('.', '\\.')}\\s*\\(`, 'gi');
  for (const { fichier, texte } of migrations) {
    for (const m of texte.matchAll(re)) {
      const d = texte.indexOf('$$', m.index), f = d < 0 ? -1 : texte.indexOf('$$', d + 2);
      if (f > 0) { corps = texte.slice(m.index, f); ou = `${fichier}:${ligneDe(texte, m.index)}`; }
    }
  }
  return corps === null ? null : { corps, ou };
}

// Lignes d'une table qui parlent d'une colonne : sa définition dans create table, et les alter table … check
function definitionsColonne(migrations, table, col) {
  const defs = [];
  const t = table.replace('.', '\\.');
  for (const { fichier, texte } of migrations) {
    for (const m of texte.matchAll(new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${t}\\s*\\(`, 'gi'))) {
      const bloc = blocParentheses(texte, m.index + m[0].length - 1);
      const l = bloc.split('\n').find(x => new RegExp(`^\\s*${col}\\s+\\w`).test(x));
      if (l) defs.push({ expr: l, ou: `${fichier}:${ligneDe(texte, m.index + texte.slice(m.index).indexOf(l))}` });
      // Contraintes de table sur plusieurs lignes : « constraint user_profiles_username_format check ( … ) »
      for (const k of bloc.matchAll(/constraint\s+\w+\s+check\s*\(/gi)) {
        const c = blocParentheses(bloc, k.index + k[0].length - 1);
        if (new RegExp(`\\b${col}\\b`).test(c)) defs.push({ expr: c, ou: `${fichier}:${ligneDe(texte, m.index + m[0].length + k.index)}` });
      }
    }
    for (const m of texte.matchAll(new RegExp(`alter\\s+table\\s+${t}\\s+add\\s+(?:constraint\\s+\\w+\\s+check|column\\s+${col}\\b)[^;]*;`, 'gi'))) {
      if (new RegExp(`\\b${col}\\b`).test(m[0])) defs.push({ expr: m[0], ou: `${fichier}:${ligneDe(texte, m.index)}` });
    }
  }
  return defs;
}

// cible : { table: 'public.coach_plans', colonne: 'name' } ou { fonction: 'public.coach_request_submit', variable: 'nm' }
// → { longMin?, longMax?, min?, max?, motif?, ou } ; null si rien n'est trouvé (le registre est alors périmé)
export function bornesSql(migrations, cible) {
  if (cible.fonction) {
    const f = corpsFonction(migrations, cible.fonction);
    if (!f) return null;
    if (cible.regex) {   // expression sans nom de variable : « (k.v #>> '{}')::numeric between 0 and 500 »
      const m = f.corps.match(new RegExp(cible.regex, 'i'));
      return m ? { min: +m[1], max: +m[2], ou: f.ou } : null;
    }
    const b = bornesExpression(f.corps, cible.variable);
    return Object.keys(b).length ? { ...b, ou: f.ou } : null;
  }
  const defs = definitionsColonne(migrations, cible.table, cible.colonne);
  let out = null;
  for (const d of defs) {   // dans l'ordre des migrations : la dernière contrainte trouvée gagne
    const b = bornesExpression(d.expr, cible.colonne);
    if (Object.keys(b).length) out = { ...b, ou: d.ou };
  }
  return out;
}
