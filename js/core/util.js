// ═══════════════════════════════════════════════════════════
//  Utilitaires : identifiants, échappement HTML, formats français
// ═══════════════════════════════════════════════════════════
'use strict';

function uid() { return Math.random().toString(36).slice(2, 10); }
// Déplace l'élément from à la position to (tableau modifié en place)
function moveItem(arr, from, to) {
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  return arr;
}
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function pad(n) { return String(n).padStart(2, '0'); }

// ── Typographie française à l'affichage ──
// Espace fine insécable (U+202F) avant ? ! ; : et après « / avant » ; trait d'union insécable dans « mois-ci », « celle-là ».
// Rien n'est jamais réécrit dans les données ni dans les champs : seuls les nœuds de texte affichés sont touchés
// (MutationObserver ci-dessous), après chaque rendu, toast, feuille ou annonce. Un retour à la ligne ne laisse plus
// « ? » ou « : » seuls en début de ligne (panels de la vague 3).
// Aussi : « 32 kg × 10 » jamais coupé autour de « × », ni entre un nombre et son unité ou son nom (kg, min, t, %,
// séances, « 30 oct. »…), ni dans « ≈ 60 », « sem. 2/2 » ; « · » ne commence jamais une ligne (panel t5 : « min », « oct. »,
// « séances » ou « · sem. 4/10 » seuls à la ligne). Échappements \u dans le code : aucun caractère invisible dans le source.
const FR_TYPO_UNITS = 'kg|lb|min|h|j|s|t|g|kcal|km|cm|%|reps?|s\u00e9ances?|s\u00e9ries?|exercices?|jours?|semaines?|sem\\.|repas|records?'
  + '|janv\\.|f\u00e9vr\\.|mars|avr\\.|mai|juin|juil\\.|ao\u00fbt|sept\\.|oct\\.|nov\\.|d\u00e9c\\.';
const FR_TYPO_RE = new RegExp('[ \u00a0]([?!;:\u00bb])|(\u00ab)[ \u00a0]|(\\S)-(ci|l\u00e0)(?![\\p{L}])| \u00d7 (?=\\S)'
  + `|(\\d) (${FR_TYPO_UNITS})(?![\\p{L}])|(\u2248|sem\\.) (?=\\d)`, 'gu');
function frTypo(str) {
  return String(str ?? '').replace(FR_TYPO_RE, (m, before, open, w, tail, d, unit, lead) =>
    before ? '\u202f' + before : open ? open + '\u202f' : w ? w + '\u2011' + tail : d ? d + '\u202f' + unit
      : lead ? lead + '\u202f' : '\u202f\u00d7\u202f')
    .replace(/ \u00b7 /g, '\u202f\u00b7 ')
    .replace(FR_TYPO_GLUE_RE, '$1\u202f')   // « L 1 », « P 5 » (macros) et « repos 2:00 » jamais séparés (panel t6)
    .replace(/(\d)-(?=\d)/g, '$1\u2011');   // tempo « 3-1-1 » jamais coupé (« Ex. 3- » puis « 1-1 »)   // à part : « 1,3 t · 53 min » (l'unité vient d'être prise par la règle du dessus)
}
const FR_TYPO_GLUE_RE = /(?<=^|[\s(])(\p{Lu}|j|\p{L}{2,}(?= \d{1,2}:\d\d)) (?=\d)/gu;
const FR_TYPO_SKIP = 'textarea, input, script, style, [contenteditable]';
function frTypoNode(root) {
  if (!root) return;
  if (root.nodeType === 3) { frTypoText(root); return; }
  if (root.nodeType !== 1 || root.closest?.(FR_TYPO_SKIP)) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) frTypoText(n);
}
const FR_TYPO_TEST = new RegExp(`[ \u00a0][?!;:\u00bb]|\u00ab[ \u00a0]|-(ci|l\u00e0)| \u00d7 |\\d (${FR_TYPO_UNITS})|(\u2248|sem\\.) \\d| \u00b7 |\\d-\\d|(?:^|\\s)(?:\\p{Lu}|j) \\d|\\p{L} \\d{1,2}:\\d\\d`, 'u');
function frTypoText(n) {
  const v = n.data;
  const has = FR_TYPO_TEST.test(v), sep = v.includes('\u00b7');
  if ((!has && !sep) || n.parentElement?.closest(FR_TYPO_SKIP)) return;
  if (has) { const t = frTypo(v); if (t !== v) n.data = t; }
  if (n.data.includes(FR_SEP)) frSepQueue(n);
}

// ── « · » jamais en fin de ligne (panel t6) ──
// frTypo colle le « · » au mot d'avant (espace fine insécable) et laisse couper après lui : « Record 32 × 9 · » puis
// « Repos 2:00 » à la ligne. Quand la ligne casse juste là, le point est masqué (visibility : la largeur reste la même,
// la mise en page ne bouge pas) ; il revient si la largeur change. Mesuré une fois par image, après le rendu, et
// seulement sur les nœuds qui portent un séparateur (quelques dizaines par écran).
const FR_SEP = '\u202f\u00b7';
const frSepNodes = new Set();
let frSepFrame = 0;
function frSepQueue(n) {
  frSepNodes.add(n);
  if (!frSepFrame && typeof requestAnimationFrame === 'function') frSepFrame = requestAnimationFrame(frSepCheck);
}
// Rectangle du premier caractère visible après la position (n, i) : même nœud, ou nœuds de texte suivants
function frNextCharRect(n, i, range) {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  walk.currentNode = n;
  for (let node = n, k = 0; node && k < 6; node = walk.nextNode(), i = 0, k++) {
    const j = node.data.slice(i).search(/\S/);
    if (j < 0) continue;
    range.setStart(node, i + j); range.setEnd(node, i + j + 1);
    return range.getClientRects()[0] || null;
  }
  return null;
}
function frSepCheck() {
  frSepFrame = 0;
  const nodes = [...frSepNodes];
  frSepNodes.clear();
  const range = document.createRange();
  // Deux passes : toutes les mesures d'abord, puis les découpes. Mesurer après une découpe forcerait un nouveau
  // calcul de la mise en page à chaque nœud (longues listes : historique, élèves)
  const todo = [];
  for (const n of nodes) {
    if (!n.isConnected || n.parentElement?.classList.contains('tsep-cut')) continue;
    const cuts = [];
    for (let i = n.data.indexOf(FR_SEP); i >= 0; i = n.data.indexOf(FR_SEP, i + 2)) {
      range.setStart(n, i + 1); range.setEnd(n, i + 2);
      const dot = range.getClientRects()[0];
      const next = dot && frNextCharRect(n, i + 2, range);
      if (next && next.top >= dot.bottom - 2) cuts.push(i + 1);
    }
    if (cuts.length) todo.push([n, cuts, /flex|grid/.test(getComputedStyle(n.parentElement).display)]);
  }
  for (const [n, cuts, inBox] of todo) {
    // Texte posé directement dans une boîte flex ou grille : découpé, il donnerait trois éléments côte à côte
    // (« Petit-déjeuner » et « 215 kcal » en colonnes) ; il est d'abord enveloppé d'un seul span, qui garde la mise en page
    if (inBox) {
      const wrap = document.createElement('span');
      n.replaceWith(wrap);
      wrap.append(n);
    }
    // De la fin vers le début : chaque découpe raccourcit n, les positions d'avant restent justes
    for (const at of cuts.reverse()) {
      range.setStart(n, at); range.setEnd(n, at + 1);
      const span = document.createElement('span');
      span.className = 'tsep-cut';
      range.surroundContents(span);
    }
  }
}
// Largeur changée (rotation, Duo ouvert, taille du texte) : points remis, puis mesurés de nouveau
function frSepRecheck() {
  document.querySelectorAll('.tsep-cut').forEach(s => { const p = s.parentNode; s.replaceWith(s.textContent); p?.normalize(); });
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.data.includes(FR_SEP)) frSepQueue(n);
}
if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(frTypoNode)))
    .observe(document.documentElement, { childList: true, subtree: true });
  let frSepW = window.innerWidth, frSepT = 0;
  window.addEventListener('resize', () => {
    if (window.innerWidth === frSepW) return;   // clavier ou barre d'adresse : hauteur seule, rien ne se recoupe
    frSepW = window.innerWidth;
    clearTimeout(frSepT); frSepT = setTimeout(frSepRecheck, 150);
  });
}

// Échappe le texte saisi par l'utilisateur avant de l'injecter dans le HTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Date du jour au format YYYY-MM-DD en heure locale (toISOString est en UTC)
function localISO(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Nombres ─────────────────────────────────────────────────
// Nombres à la française : « 32,5 » (virgule, espace fine pour les milliers)
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
function fmtNum(v, digits) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!isFinite(n)) return '';
  if (digits != null) return n.toLocaleString('fr-FR', { maximumFractionDigits: digits });
  return nf.format(n);
}

// ── Durées ──────────────────────────────────────────────────
// Format chrono, sans zéro devant le premier nombre : « 0:45 », « 42:07 », « 1:02:07 ».
// hours: false garde les minutes au-delà d'une heure (« 75:00 ») : c'est le format du repos.
function fmtClock(ms, { hours = true } = {}) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = hours ? Math.floor(s / 3600) : 0;
  const m = Math.floor((s - h * 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// Repos, en secondes : « 1:30 », « 0:45 »
function fmtRest(secs) {
  return fmtClock(Math.round(secs || 0) * 1000, { hours: false });
}

// Repos dit par VoiceOver : « 1 minute 30 », « 45 secondes », « 2 minutes » (« 1:30 » se lirait comme une heure)
function fmtRestSpoken(secs) {
  const s = Math.max(0, Math.round(secs || 0)), m = Math.floor(s / 60), r = s % 60;
  if (!m) return `${r} seconde${r > 1 ? 's' : ''}`;
  return `${m} minute${m > 1 ? 's' : ''}${r ? ` ${r}` : ''}`;
}

// Durée en toutes lettres : « 42 min », « 1 h 09 »
function fmtDuration(ms) {
  const totalMin = Math.floor(Math.max(0, ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}\u00a0h\u00a0${pad(m)}`;
  return `${m}\u00a0min`;
}

// ── Dates ───────────────────────────────────────────────────
const DATE_FORMATS = {
  long:  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, // « jeudi 9 octobre 2026 »
  day:   { weekday: 'long', day: 'numeric', month: 'long' },                  // « jeudi 9 octobre »
  short: { day: 'numeric', month: 'short' },                                  // « 9 oct. »
  month: { month: 'long', year: 'numeric' },                                  // « octobre 2026 »
};

// Jours du calendrier (heure locale) entre `ts` et `now` : 0 aujourd'hui, 1 hier, négatif dans le futur.
// Jamais des tranches de 24 h (« hier 22 h » vu à 8 h, c'est hier) ni un jour de 23 ou 25 h mal compté :
// on compare les dates du calendrier, ramenées sur une échelle sans changement d'heure (UTC).
function daysAgo(ts, now = Date.now()) {
  const day = t => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  return Math.round((day(now) - day(ts)) / 86400000);
}

// Date d'un horodatage ou d'un objet Date. Sans style : « Aujourd'hui », « Hier », sinon
// « jeu. 9 oct. » (l'année seulement si ce n'est pas l'année en cours). Styles : DATE_FORMATS.
// Formateurs Intl gardés : toLocaleDateString en recrée un à chaque appel (une ligne d'historique sur deux en
// passait 1 ms sur un téléphone moyen). Mêmes textes : chaque format porte des champs de date.
const DATE_FMT_CACHE = new Map();
function dateFmt(key, opts) {
  let f = DATE_FMT_CACHE.get(key);
  if (!f) { f = new Intl.DateTimeFormat('fr-FR', opts); DATE_FMT_CACHE.set(key, f); }
  return f;
}
function fmtDate(ts, style) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return d.toLocaleDateString('fr-FR');   // « Invalid Date », comme avant (format() lèverait une erreur)
  if (style) return DATE_FORMATS[style] ? dateFmt(style, DATE_FORMATS[style]).format(d) : d.toLocaleDateString('fr-FR', DATE_FORMATS[style]);
  const today = new Date();
  const diff = daysAgo(d, today);
  if (diff === 0) return 'Aujourd\'hui';
  if (diff === 1) return 'Hier';
  const year = d.getFullYear() !== today.getFullYear();
  return dateFmt(year ? 'courte+an' : 'courte', { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).format(d);
}

// Heure : « 14:05 »
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Icône du sprite de index.html (style SF Symbols), décorative : le libellé vient du bouton
function icon(name, size = 22) {
  return `<svg class="icon icon--${name.replace(/\./g, '-')}" width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

// Copie profonde (structuredClone absent avant iOS 15.4)
function clone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

// Nombre saisi borné : accepte la virgule décimale, renvoie null si vide, invalide ou hors bornes.
// Écriture décimale simple seulement : Number() lisait aussi « 0x14 » (20), « 1e3 » (1000) ou « Infinity »,
// et le collage « 2,5,5 » doit être refusé, pas tronqué (audit du 12/11, m3)
const NUM_RE = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
function num(v, min, max, int = false) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v)) ? v : null;
  const raw = String(v ?? '').trim();
  if (raw === '') return null;
  if (!NUM_RE.test(raw)) return null;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return null;
  return n;
}

// Saisie de reps (ou de secondes, de minutes) : chiffres seuls. Un collage « 12abc » ou « 1e3 » ne
// survit plus au rechargement ni ne s'affiche « 20 kg × abc » (audit du 12/11, m3)
function cleanReps(v) { return String(v ?? '').replace(/\D/g, '').slice(0, 4); }

// Nom d'exercice comparable : minuscules, sans accents, espaces réduits
// Exécute fn juste après le prochain affichage : un appel natif lent (son, Live Activity) ne retarde
// jamais la réponse visible d'un toucher
function afterPaint(fn) { requestAnimationFrame(() => setTimeout(fn, 0)); }

// Mémorisé : appelé des dizaines de milliers de fois pour quelques dizaines de noms (Progrès, records, historique :
// 1 200 séances, 1,5 s sur 4 s de calcul passaient dans normalize('NFD')). Le cache est vidé s'il grossit trop
// (recherche tapée lettre à lettre, noms importés).
const NORM_NAME_CACHE = new Map();
function normName(name) {
  const s = String(name ?? '');
  let v = NORM_NAME_CACHE.get(s);
  if (v === undefined) {
    if (NORM_NAME_CACHE.size >= 5000) NORM_NAME_CACHE.clear();
    v = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    NORM_NAME_CACHE.set(s, v);
  }
  return v;
}

// Même exercice ? Par identifiant stable si les deux en ont un, sinon par nom normalisé.
// Les exercices du programme portent `id`, ceux de l'historique et de la séance `exId`.
function exIdOf(o) { return o?.exId || o?.id || null; }
function sameEx(a, b) {
  const ia = exIdOf(a), ib = exIdOf(b);
  return (ia && ib) ? ia === ib : normName(a?.name) === normName(b?.name);
}

// Clé d'un exercice connu par son seul nom : « n: » + nom normalisé. Stockée dans l'historique (exId),
// les records et Progrès : son format ne doit jamais changer.
function nameKey(name) { return 'n:' + normName(name); }
// Clé de regroupement d'un exercice : son identifiant (exId de l'historique, sinon id du programme),
// sinon son nom. Les records ont leur propre clé, recordKey (js/data/records.js), qui ignore l'id.
function exKey(ex) { return exIdOf(ex) || nameKey(ex?.name); }

// Programme d'une séance de l'historique : les séances d'avant les programmes n'en ont pas, c'est « ppl ».
// Ici et non dans js/data/accessors.js : la migration de la donnée (js/data/store.js) s'en sert au chargement.
function entryProg(h) { return h?.programme || 'ppl'; }

function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }
// Élision devant un mot (souvent un pseudo) : « de max », « d'essai », « que max », « qu'essai ». Voyelle,
// ou h (muet dans presque tous les cas) ; pas devant y (« de Yann »). word : de, que, le, la, je, ne… ; next : texte déjà échappé s'il va dans du HTML
function elide(word, next) {
  const n = String(next ?? '');
  return /^[aeiouàâäéèêëîïôöùûüœæh]/i.test(n) ? `${word.slice(0, -1)}'${n}` : `${word} ${n}`;
}
