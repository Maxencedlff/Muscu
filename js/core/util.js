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
const FR_TYPO_UNITS = 'kg|lb|min|h|s|t|g|kcal|km|cm|%|reps?|s\u00e9ances?|s\u00e9ries?|exercices?|jours?|semaines?|sem\\.|repas|records?'
  + '|janv\\.|f\u00e9vr\\.|mars|avr\\.|mai|juin|juil\\.|ao\u00fbt|sept\\.|oct\\.|nov\\.|d\u00e9c\\.';
const FR_TYPO_RE = new RegExp('[ \u00a0]([?!;:\u00bb])|(\u00ab)[ \u00a0]|(\\S)-(ci|l\u00e0)(?![\\p{L}])| \u00d7 (?=\\S)'
  + `|(\\d) (${FR_TYPO_UNITS})(?![\\p{L}])|(\u2248|sem\\.) (?=\\d)`, 'gu');
function frTypo(str) {
  return String(str ?? '').replace(FR_TYPO_RE, (m, before, open, w, tail, d, unit, lead) =>
    before ? '\u202f' + before : open ? open + '\u202f' : w ? w + '\u2011' + tail : d ? d + '\u202f' + unit
      : lead ? lead + '\u202f' : '\u202f\u00d7\u202f')
    .replace(/ \u00b7 /g, '\u202f\u00b7 ')
    .replace(/(\d)-(?=\d)/g, '$1\u2011');   // tempo « 3-1-1 » jamais coupé (« Ex. 3- » puis « 1-1 »)   // à part : « 1,3 t · 53 min » (l'unité vient d'être prise par la règle du dessus)
}
const FR_TYPO_SKIP = 'textarea, input, script, style, [contenteditable]';
function frTypoNode(root) {
  if (!root) return;
  if (root.nodeType === 3) { frTypoText(root); return; }
  if (root.nodeType !== 1 || root.closest?.(FR_TYPO_SKIP)) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) frTypoText(n);
}
const FR_TYPO_TEST = new RegExp(`[ \u00a0][?!;:\u00bb]|\u00ab[ \u00a0]|-(ci|l\u00e0)| \u00d7 |\\d (${FR_TYPO_UNITS})|(\u2248|sem\\.) \\d| \u00b7 |\\d-\\d`, 'u');
function frTypoText(n) {
  const v = n.data;
  if (!FR_TYPO_TEST.test(v) || n.parentElement?.closest(FR_TYPO_SKIP)) return;
  const t = frTypo(v);
  if (t !== v) n.data = t;
}
if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(frTypoNode)))
    .observe(document.documentElement, { childList: true, subtree: true });
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
function fmtDate(ts, style) {
  const d = new Date(ts);
  if (style) return d.toLocaleDateString('fr-FR', DATE_FORMATS[style]);
  const today = new Date();
  const diff = daysAgo(d, today);
  if (diff === 0) return 'Aujourd\'hui';
  if (diff === 1) return 'Hier';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('fr-FR', opts);
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

// Nombre saisi borné : accepte la virgule décimale, renvoie null si vide, invalide ou hors bornes
function num(v, min, max, int = false) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return null;
  return n;
}

// Nom d'exercice comparable : minuscules, sans accents, espaces réduits
// Exécute fn juste après le prochain affichage : un appel natif lent (son, Live Activity) ne retarde
// jamais la réponse visible d'un toucher
function afterPaint(fn) { requestAnimationFrame(() => setTimeout(fn, 0)); }

function normName(name) {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
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
