// ═══════════════════════════════════════════════════════════
//  Mensurations : tour de poitrine, taille, hanches, bras, cuisses… (logique pure)
// ═══════════════════════════════════════════════════════════
//
// data.bodyMeasures = { chest: [{ date, cm }], waist: [...], … } : par mesure, du plus récent au plus
// ancien, une valeur par jour au plus (la dernière saisie du jour), BODY_MEASURE_MAX au plus.
// Toujours stockées en cm (comme les charges en kg) ; affichées en cm ou en pouces selon l'unité de
// l'app (lbs → in). Donnée privée : jamais sur le serveur (SYNC_LOCAL_ONLY, js/data/sync.js), jamais
// montrée aux amis ni au coach ; gardée dans l'export et, dans l'app iPhone, dans la copie iCloud, comme
// le poids du corps. Chargé avant store.js : sanitizeData() nettoie la donnée dès le lancement.
'use strict';

const BODY_MEASURES = [
  { key: 'chest',     label: 'Poitrine' },
  { key: 'waist',     label: 'Taille' },
  { key: 'hips',      label: 'Hanches' },
  { key: 'shoulders', label: 'Épaules' },
  { key: 'neck',      label: 'Cou' },
  { key: 'armL',      label: 'Bras gauche' },
  { key: 'armR',      label: 'Bras droit' },
  { key: 'thighL',    label: 'Cuisse gauche' },
  { key: 'thighR',    label: 'Cuisse droite' },
  { key: 'calf',      label: 'Mollet' },
];
const BODY_MEASURE_KEYS = BODY_MEASURES.map(m => m.key);
const BODY_MEASURE_MAX  = 400;         // valeurs gardées par mesure (plus d'un an de mesures quotidiennes)
const BODY_CM_MIN = 10, BODY_CM_MAX = 250;   // du cou d'un enfant au tour de hanches le plus large ; au-delà : faute de frappe
const CM_PER_IN = 2.54;

function bodyMeasureLabel(key) { return BODY_MEASURES.find(m => m.key === key)?.label || ''; }

// ── Unités ──────────────────────────────────────────────────
function lenUnitLbl() { return data.unit === 'lbs' ? 'in' : 'cm'; }
// cm stockés → nombre dans l'unité affichée, au dixième
function toUnitLen(cm) {
  const v = parseFloat(cm);
  if (!Number.isFinite(v)) return null;
  return Math.round((data.unit === 'lbs' ? v / CM_PER_IN : v) * 10) / 10;
}
// « 92,5 » ; plain : « 92,5 » sans séparateur de milliers (valeur d'un champ)
function fmtLen(cm, { plain = false } = {}) {
  const v = toUnitLen(cm);
  if (v === null) return '';
  return plain ? String(v).replace('.', ',') : fmtNum(v, 1);
}
// Saisie dans l'unité affichée → cm (nombre au dixième), null si vide ou hors bornes
function storeLen(val) {
  const lbs = data.unit === 'lbs';
  const v = num(val, lbs ? BODY_CM_MIN / CM_PER_IN : BODY_CM_MIN, lbs ? BODY_CM_MAX / CM_PER_IN : BODY_CM_MAX);
  if (v === null) return null;
  return Math.round((lbs ? v * CM_PER_IN : v) * 10) / 10;
}
// Écart signé affiché : « +1,5 cm », « −0,5 in », '' si nul ou inconnu
function fmtLenDelta(cm) {
  if (cm == null || !Number.isFinite(cm)) return '';
  const v = Math.round(Math.abs(data.unit === 'lbs' ? cm / CM_PER_IN : cm) * 10) / 10;
  if (!v) return '';
  return `${cm > 0 ? '+' : '−'}${fmtNum(v, 1)} ${lenUnitLbl()}`;
}

// Date d'un <input type="date"> → horodatage : maintenant si c'est aujourd'hui (l'ordre du jour est gardé),
// midi sinon ; null si vide, illisible ou dans le futur
function dateInputToTs(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (!m) return null;
  if (v === localISO()) return Date.now();
  const ts = new Date(+m[1], m[2] - 1, +m[3], 12).getTime();
  return Number.isFinite(ts) && ts <= Date.now() ? ts : null;
}

// ── Donnée ──────────────────────────────────────────────────
const bodyDayKey = ts => localISO(ts);

// Nettoie { key: [{ date, cm }] } venu du stockage ou d'un import : clés connues, valeurs bornées, une
// par jour, du plus récent au plus ancien, mesures vides retirées (idempotent)
function cleanBodyMeasures(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const key of BODY_MEASURE_KEYS) {
    const log = obj[key];
    if (!Array.isArray(log)) continue;
    const seen = new Set();
    const clean = log
      .filter(p => p && Number.isFinite(p.date) && p.date > 0 && Number.isFinite(p.cm) && p.cm >= BODY_CM_MIN && p.cm <= BODY_CM_MAX)
      .map(p => ({ date: p.date, cm: Math.round(p.cm * 10) / 10 }))
      .sort((a, b) => b.date - a.date)
      .filter(p => { const k = bodyDayKey(p.date); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, BODY_MEASURE_MAX);
    if (clean.length) out[key] = clean;
  }
  return out;
}

// Nouvelle mesure : remplace celle du même jour
function logBodyMeasure(key, cm, date = Date.now()) {
  if (!BODY_MEASURE_KEYS.includes(key)) return;
  const log = (data.bodyMeasures?.[key] || []).filter(p => bodyDayKey(p.date) !== bodyDayKey(date));
  data.bodyMeasures = cleanBodyMeasures({ ...(data.bodyMeasures || {}), [key]: [{ date, cm }, ...log] });
}
function removeBodyMeasure(key, date) {
  if (!data.bodyMeasures?.[key]) return;
  data.bodyMeasures = cleanBodyMeasures({ ...data.bodyMeasures, [key]: data.bodyMeasures[key].filter(p => p.date !== date) });
  if (!Object.keys(data.bodyMeasures).length) delete data.bodyMeasures;
}

// Série d'une mesure dans l'ordre chronologique (courbes)
function bodyMeasureSeries(key, d = data) { return (d.bodyMeasures?.[key] || []).slice().sort((a, b) => a.date - b.date); }

// Dernière valeur et écarts (cm) : par rapport à la mesure d'avant et à la première ; null sans assez de points
function bodyMeasureDelta(series) {
  const n = series.length;
  if (!n) return null;
  const last = series[n - 1];
  const r = v => Math.round(v * 10) / 10;
  return { last, dPrev: n > 1 ? r(last.cm - series[n - 2].cm) : null, dFirst: n > 1 ? r(last.cm - series[0].cm) : null, count: n };
}

// Nombre de mesures renseignées et date de la plus récente (cellule de Progrès)
function bodyMeasureSummary(d = data) {
  const keys = Object.keys(d.bodyMeasures || {});
  const latest = Math.max(0, ...keys.map(k => d.bodyMeasures[k][0]?.date || 0));
  return { count: keys.length, latest: latest || null };
}
