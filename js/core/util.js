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

function fmt72(ms) {
  if (ms <= 0) return 'Prête !';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

// Nombres à la française : « 32,5 » (virgule, espace fine pour les milliers)
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
function fmtNum(v, digits) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!isFinite(n)) return '';
  if (digits != null) return n.toLocaleString('fr-FR', { maximumFractionDigits: digits });
  return nf.format(n);
}

// Repos : « 1:30 », « 0:45 » (pas de zéro devant les minutes)
function fmtRest(secs) {
  secs = Math.max(0, Math.round(secs || 0));
  return `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
}

// Chrono de séance : « 0:12 », « 42:07 », puis « 1:02:07 » au-delà d'une heure
// (pas de zéro devant les minutes, comme le repos)
function fmtClock(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// « Aujourd'hui », « Hier », sinon « jeu. 9 oct. » (l'année seulement si ce n'est pas l'année en cours)
function fmtDate(ts) {
  const d = new Date(ts);
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

// Durées : « 42 min », « 1 h 09 »
function fmtDuration(ms) {
  const totalMin = Math.floor(Math.max(0, ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}\u00a0h\u00a0${pad(m)}`;
  return `${m}\u00a0min`;
}

// Icône du sprite de index.html (style SF Symbols), décorative : le libellé vient du bouton
function icon(name, size = 22) {
  return `<svg class="icon icon--${name.replace(/\./g, '-')}" width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

// Valeur d'un token CSS (« var(--orange) » → « #FF9F0A ») : le canvas ne comprend pas var()
function cssColor(c) {
  const m = /^var\((--[\w-]+)\)$/.exec(String(c || '').trim());
  if (!m) return c;
  return getComputedStyle(document.body).getPropertyValue(m[1]).trim() || c;
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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
