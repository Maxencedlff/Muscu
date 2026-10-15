// ═══════════════════════════════════════════════════════════
//  Utilitaires : identifiants, échappement HTML, formats français
// ═══════════════════════════════════════════════════════════
'use strict';

function uid() { return Math.random().toString(36).slice(2, 10); }
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function pad(n) { return String(n).padStart(2, '0'); }

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

// Date d'un horodatage ou d'un objet Date. Sans style : « Aujourd'hui », « Hier », sinon
// « jeu. 9 oct. » (l'année seulement si ce n'est pas l'année en cours). Styles : DATE_FORMATS.
function fmtDate(ts, style) {
  const d = new Date(ts);
  if (style) return d.toLocaleDateString('fr-FR', DATE_FORMATS[style]);
  const today = new Date();
  const day0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day0 - dd) / 86400000);
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

function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }
