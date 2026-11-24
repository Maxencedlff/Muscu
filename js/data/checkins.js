// ═══════════════════════════════════════════════════════════
//  Bilans configurables par le coach (docs/BILANS.md) : logique pure, partagée par l'app iPhone et l'appli web
//  du coach (coach-web/index.html charge ce fichier tel quel). Aucun accès au DOM, au stockage ni au serveur.
//
//  - Catalogue fermé des suivis (CHECKIN_KINDS) : tout ce qu'un coach peut cocher, avec son type, son unité et les
//    libellés des bornes de l'échelle ; plus des questions libres (kind 'custom').
//  - checkinItemClean / checkinItemsClean : un modèle tel que le serveur l'accepte (mêmes règles que
//    private.checkin_item_ok de supabase/migrations/20261125010000_bilans_coach.sql : tout ce qui est refusé ici
//    l'est aussi là-bas, testé des deux côtés).
//  - checkinValueClean : une réponse valide pour un suivi (mêmes règles que private.checkin_value_ok).
//  - checkinPrefill : ce que l'app sait déjà (dernière pesée, mensurations, jours de diète cochés, séances, pas).
//  - Textes : checkinValueText (fiche du coach), checkinScheduleText (« Chaque semaine · dimanche 18 h »),
//    checkinMinutes (« environ 3 minutes »).
// ═══════════════════════════════════════════════════════════
'use strict';

const CHECKIN_ITEMS_MAX = 60;       // suivis par modèle (comme le serveur)
const CHECKIN_TEMPLATES_MAX = 50;   // modèles par coach
const CHECKIN_NAME_MAX = 60;        // nom d'un modèle
const CHECKIN_LABEL_MAX = 120;      // intitulé d'un suivi ou d'une question
const CHECKIN_BOUND_MAX = 30;       // libellé d'une borne d'échelle (« Très bien »)
const CHECKIN_UNIT_MAX = 12;        // unité d'une question « nombre » (« verres »)
const CHECKIN_TEXT_MAX = 1000;      // réponse écrite
const CHECKIN_REPLY_MAX = 2000;     // réponse du coach
const CHECKIN_GROUP_NAME_MAX = 40;  // nom d'un groupe d'élèves
const CHECKIN_POSES = ['face', 'side', 'back'];   // mêmes poses que les photos de bilan (PHOTO_POSE_KEYS)
const CHECKIN_POSE_LABELS = { face: 'Face', side: 'Profil', back: 'Dos' };
const CHECKIN_MEASURE_KEYS = ['chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf'];   // BODY_MEASURE_KEYS
const CHECKIN_CYCLE_PHASES = [['menses', 'Règles'], ['follicular', 'Après les règles'], ['ovulation', 'Ovulation'], ['luteal', 'Avant les règles'], ['unknown', 'Je ne sais pas']];
const CHECKIN_KEY_RE = /^(?:[a-z_]{3,20}|q[a-z0-9]{8})$/;
const CHECKIN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Bornes d'un nombre selon son unité (kg, cm, pas par jour, minutes par semaine) ; question libre : large
const CHECKIN_NUMBER_RANGE = { kg: [25, 300], cm: [10, 250], steps: [0, 100000], min: [0, 10080], custom: [-1000000, 1000000] };

// Catalogue fermé. group : rubrique de l'éditeur et de l'écran de l'élève (Corps, Activité et plan, Ressenti).
// types : types permis (le premier par défaut). sensitive : jamais obligatoire, « Passer » toujours possible.
const CHECKIN_KINDS = Object.freeze([
  { kind: 'weight', group: 'body', label: 'Poids', types: ['number'], unit: 'kg', icon: 'weight', help: 'Prérempli avec sa dernière pesée' },
  { kind: 'measures', group: 'body', label: 'Mensurations', types: ['number'], unit: 'cm', icon: 'tape', help: 'Mensurations choisies', options: { keys: ['waist', 'hips', 'thighL'] } },
  { kind: 'photos', group: 'body', label: 'Photos', types: ['photo'], icon: 'photo', help: 'Chiffrées de bout en bout', options: { poses: ['face', 'side', 'back'] } },
  { kind: 'diet_adherence', group: 'activity', label: 'Respect du plan diète', types: ['auto'], icon: 'diet', help: 'Jours suivis, d\'après les repas cochés' },
  { kind: 'training_adherence', group: 'activity', label: 'Respect de l\'entraînement', types: ['auto'], icon: 'programmes', help: 'Séances faites sur les séances du programme' },
  { kind: 'steps', group: 'activity', label: 'Pas par jour', types: ['number'], unit: 'steps', icon: 'steps', help: 'Moyenne de la période' },
  { kind: 'cardio', group: 'activity', label: 'Cardio', types: ['number'], unit: 'min', icon: 'heart', help: 'Minutes sur la période' },
  { kind: 'pain', group: 'activity', label: 'Douleurs ou blessures', types: ['yesno', 'text'], icon: 'bandage', help: 'Où, depuis quand', sensitive: true },
  { kind: 'sleep', group: 'feel', label: 'Sommeil', types: ['scale'], scale: 5, lo: 'Mal', hi: 'Très bien', icon: 'moon' },
  { kind: 'energy', group: 'feel', label: 'Énergie', types: ['scale'], scale: 5, lo: 'À plat', hi: 'Au top', icon: 'bolt' },
  { kind: 'hunger', group: 'feel', label: 'Faim', types: ['scale'], scale: 5, lo: 'Aucune', hi: 'Tout le temps', icon: 'diet' },
  { kind: 'stress', group: 'feel', label: 'Stress', types: ['scale'], scale: 5, lo: 'Aucun', hi: 'Très fort', icon: 'brain' },
  { kind: 'digestion', group: 'feel', label: 'Digestion', types: ['scale'], scale: 5, lo: 'Difficile', hi: 'Parfaite', icon: 'leaf' },
  { kind: 'fatigue', group: 'feel', label: 'Fatigue', types: ['scale'], scale: 5, lo: 'Aucune', hi: 'Très forte', icon: 'battery' },
  { kind: 'mood', group: 'feel', label: 'Humeur', types: ['scale'], scale: 5, lo: 'Au plus bas', hi: 'Excellente', icon: 'smile' },
  { kind: 'libido', group: 'feel', label: 'Libido', types: ['scale'], scale: 5, lo: 'Très basse', hi: 'Très haute', icon: 'heart', sensitive: true },
  { kind: 'cycle', group: 'feel', label: 'Cycle menstruel', types: ['choice'], icon: 'calendar', help: 'Proposé à l\'élève, jamais imposé', sensitive: true },
]);
const CHECKIN_KIND_IDS = CHECKIN_KINDS.map(k => k.kind);
const CHECKIN_GROUPS = [['body', 'Corps'], ['activity', 'Activité et plan'], ['feel', 'Ressenti'], ['custom', 'Tes questions']];
const CHECKIN_CUSTOM_TYPES = ['scale', 'yesno', 'number', 'text'];
const CHECKIN_TYPE_LABELS = { scale: 'Échelle', yesno: 'Oui/non', number: 'Nombre', text: 'Texte', photo: 'Photo', auto: 'Auto', choice: 'Choix' };
const CHECKIN_UNIT_LABELS = { kg: 'kg', cm: 'cm', steps: 'pas/jour', min: 'min' };
const CHECKIN_FREQS = [['week', 'Chaque semaine'], ['2weeks', 'Toutes les 2 semaines'], ['month', 'Chaque mois'], ['manual', 'À la demande']];
const CHECKIN_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];   // 0 = dimanche (getDay, extract(dow))

const checkinKind = kind => CHECKIN_KINDS.find(k => k.kind === kind) || null;

// Texte brut, une ligne, sans caractère de contrôle, borné ; '' si vide
function checkinLine(v, max) {
  if (typeof v !== 'string') return '';
  const s = Array.from(v, ch => { const c = ch.charCodeAt(0); return c < 32 || (c >= 127 && c < 160) ? ' ' : ch; }).join('').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}
// Texte d'une réponse : retours à la ligne gardés (3 au plus d'affilée), contrôles retirés, borné
function checkinText(v, max = CHECKIN_TEXT_MAX) {
  if (typeof v !== 'string') return '';
  const s = Array.from(v.replace(/\r\n?/g, '\n'), ch => { const c = ch.charCodeAt(0); return ch !== '\n' && (c < 32 || (c >= 127 && c < 160)) ? ' ' : ch; }).join('')
    .replace(/[ \t]+/g, ' ').replace(/\n{4,}/g, '\n\n\n').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

// Une question libre : clé « q » + 8 caractères (a-z, 0-9), tirée au hasard
function checkinNewKey(rand = Math.random) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return 'q' + Array.from({ length: 8 }, () => abc[Math.floor(rand() * abc.length)]).join('');
}

// Un suivi d'un modèle → forme exacte gardée par le serveur, ou null s'il est refusé.
// { key, kind, label, type, required, scale?, lo?, hi?, unit?, options? }
function checkinItemClean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = raw.kind === 'custom' ? 'custom' : CHECKIN_KIND_IDS.includes(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  const def = checkinKind(kind);
  const types = def ? def.types : CHECKIN_CUSTOM_TYPES;
  const type = types.includes(raw.type) ? raw.type : null;
  if (!type) return null;
  const key = kind === 'custom' ? raw.key : kind;
  if (typeof key !== 'string' || !CHECKIN_KEY_RE.test(key) || (kind === 'custom' && !/^q[a-z0-9]{8}$/.test(key))) return null;
  const label = checkinLine(raw.label, CHECKIN_LABEL_MAX) || (def ? def.label : '');
  if (!label) return null;
  const out = { key, kind, label, type, required: !def?.sensitive && raw.required === true };
  if (type === 'scale') {
    out.scale = raw.scale === 10 ? 10 : raw.scale === 5 ? 5 : def?.scale || 5;
    out.lo = checkinLine(raw.lo, CHECKIN_BOUND_MAX) || def?.lo || '';
    out.hi = checkinLine(raw.hi, CHECKIN_BOUND_MAX) || def?.hi || '';
  }
  if (type === 'number') out.unit = def ? def.unit : checkinLine(raw.unit, CHECKIN_UNIT_MAX);
  if (kind === 'measures') {
    const keys = Array.isArray(raw.options?.keys) ? CHECKIN_MEASURE_KEYS.filter(k => raw.options.keys.includes(k)) : [];
    if (!keys.length) return null;
    out.options = { keys };
  }
  if (kind === 'photos') {
    const poses = Array.isArray(raw.options?.poses) ? CHECKIN_POSES.filter(k => raw.options.poses.includes(k)) : [];
    if (!poses.length) return null;
    out.options = { poses };
  }
  return out;
}
// Les suivis d'un modèle : nettoyés, sans doublon de clé, 60 au plus, dans l'ordre choisi par le coach
function checkinItemsClean(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const raw of list) {
    const it = checkinItemClean(raw);
    if (!it || seen.has(it.key)) continue;
    seen.add(it.key); out.push(it);
    if (out.length >= CHECKIN_ITEMS_MAX) break;
  }
  return out;
}
// Suivi du catalogue, réglages par défaut (cases de l'éditeur)
function checkinDefaultItem(kind) {
  const d = checkinKind(kind);
  if (!d) return null;
  return checkinItemClean({ kind, type: d.types[0], label: d.label, scale: d.scale, lo: d.lo, hi: d.hi, options: d.options });
}

// Un nombre dans les bornes de son unité, arrondi au centième ; null sinon
function checkinNumber(v, unit) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.').replace(/\s/g, '')) : NaN;
  const [lo, hi] = CHECKIN_NUMBER_RANGE[unit] || CHECKIN_NUMBER_RANGE.custom;
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return unit === 'steps' || unit === 'min' ? Math.round(n) : Math.round(n * 100) / 100;
}

// Réponse à un suivi → valeur gardée par le serveur, ou undefined si elle est refusée (null n'est jamais une
// réponse : un suivi passé n'a pas de ligne). Formes :
//   scale : entier 1..scale ; yesno : { yes, note? } ; number : nombre ; text : texte ;
//   measures : { clé: cm } (au moins une) ; photo : { ids: [uuid] } (photos de bilan déjà envoyées) ;
//   auto : { done, of } (0 ≤ done ≤ of ≤ 31) ; choice (cycle) : une phase de CHECKIN_CYCLE_PHASES
function checkinValueClean(item, v) {
  if (!item || v === null || v === undefined) return undefined;
  if (item.type === 'scale') return Number.isInteger(v) && v >= 1 && v <= (item.scale === 10 ? 10 : 5) ? v : undefined;
  if (item.type === 'yesno') {
    if (!v || typeof v !== 'object' || typeof v.yes !== 'boolean') return undefined;
    const note = v.yes ? checkinText(v.note) : '';
    return note ? { yes: v.yes, note } : { yes: v.yes };
  }
  if (item.type === 'text') { const t = checkinText(v); return t || undefined; }
  if (item.type === 'number' && item.kind === 'measures') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    for (const k of item.options?.keys || []) { const n = checkinNumber(v[k], 'cm'); if (n !== null) out[k] = n; }
    return Object.keys(out).length ? out : undefined;
  }
  if (item.type === 'number') { const n = checkinNumber(v, item.kind === 'custom' ? 'custom' : item.unit); return n === null ? undefined : n; }
  if (item.type === 'photo') {
    const ids = Array.isArray(v?.ids) ? [...new Set(v.ids.filter(x => typeof x === 'string' && CHECKIN_UUID_RE.test(x)))].slice(0, 9) : [];
    return ids.length ? { ids } : undefined;
  }
  if (item.type === 'auto') {
    const done = v?.done, of = v?.of;
    return Number.isInteger(done) && Number.isInteger(of) && done >= 0 && of >= 1 && done <= of && of <= 31 ? { done, of } : undefined;
  }
  if (item.type === 'choice') return CHECKIN_CYCLE_PHASES.some(([k]) => k === v) ? v : undefined;
  return undefined;
}
// Toutes les réponses d'un bilan : { clé: valeur } des seuls suivis du bilan, valeurs valides ; missing : les
// suivis obligatoires sans réponse
function checkinAnswersClean(items, answers) {
  const out = {}, missing = [];
  const src = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  for (const it of items || []) {
    const v = Object.hasOwn(src, it.key) ? checkinValueClean(it, src[it.key]) : undefined;
    if (v !== undefined) out[it.key] = v;
    else if (it.required) missing.push(it.key);
  }
  return { answers: out, missing };
}

// ── Textes ──────────────────────────────────────────────────

const CHECKIN_NF = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const CHECKIN_NF1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function checkinUnitText(item) {
  if (item.kind === 'custom') return item.unit || '';
  return CHECKIN_UNIT_LABELS[item.unit] || '';
}
// Réponse lisible (fiche du coach, récapitulatif de l'élève) ; '—' sans réponse
function checkinValueText(item, v) {
  if (v === undefined || v === null) return '—';
  if (item.type === 'scale') return `${v} sur ${item.scale}`;
  if (item.type === 'yesno') return `${v.yes ? 'Oui' : 'Non'}${v.note ? ` : ${v.note}` : ''}`;
  if (item.type === 'text') return v;
  if (item.type === 'number' && item.kind === 'measures') {
    return Object.entries(v).map(([k, cm]) => `${CHECKIN_MEASURE_LABELS[k] || k} ${CHECKIN_NF1.format(cm)} cm`).join(', ');
  }
  if (item.type === 'number') { const u = checkinUnitText(item); return `${item.unit === 'kg' ? CHECKIN_NF1.format(v) : CHECKIN_NF.format(v)}${u ? ` ${u}` : ''}`; }
  if (item.type === 'photo') return v.ids.length === 1 ? '1 photo' : `${v.ids.length} photos`;
  if (item.type === 'auto') return item.kind === 'diet_adherence' ? `${v.done} jours sur ${v.of}` : `${v.done} sur ${v.of}`;
  if (item.type === 'choice') return CHECKIN_CYCLE_PHASES.find(([k]) => k === v)?.[1] || '—';
  return '—';
}
const CHECKIN_MEASURE_LABELS = { chest: 'Poitrine', waist: 'Taille', hips: 'Hanches', shoulders: 'Épaules', neck: 'Cou', armL: 'Bras gauche', armR: 'Bras droit', thighL: 'Cuisse gauche', thighR: 'Cuisse droite', calf: 'Mollet' };
// Nombre comparable d'une réponse (colonnes de la fiche Semaines, écarts entre deux bilans) ; null sinon
function checkinValueNumber(item, v) {
  if (v === undefined || v === null) return null;
  if (item.type === 'scale' || (item.type === 'number' && item.kind !== 'measures')) return typeof v === 'number' ? v : null;
  if (item.type === 'auto') return v.done;
  return null;
}
// Type affiché dans l'éditeur (« 1 à 5 », « kg », « Oui/non », « Auto »)
function checkinTypeText(item) {
  if (item.type === 'scale') return `1 à ${item.scale}`;
  if (item.type === 'number') return checkinUnitText(item) || 'Nombre';
  if (item.kind === 'cycle') return 'En option';
  return CHECKIN_TYPE_LABELS[item.type] || '';
}
// Durée estimée pour l'élève : 10 s par échelle ou oui/non, 15 s par nombre, 40 s par texte, 30 s par photo ;
// au moins 1 minute
function checkinMinutes(items) {
  const s = (items || []).reduce((a, it) => a + (it.type === 'text' ? 40 : it.type === 'photo' ? 30 * (it.options?.poses?.length || 1)
    : it.kind === 'measures' ? 15 * (it.options?.keys?.length || 1) : it.type === 'number' ? 15 : it.type === 'auto' ? 3 : 10), 0);
  return Math.max(1, Math.round(s / 60));
}
// « Chaque semaine · dimanche 18 h », « Chaque mois · le 1er, 9 h », « À la demande »
function checkinScheduleText(s) {
  if (!s || s.freq === 'manual') return 'À la demande';
  const f = CHECKIN_FREQS.find(([k]) => k === s.freq)?.[1] || '';
  const h = Number.isInteger(s.send_hour) ? `${s.send_hour} h` : '';
  if (s.freq === 'month') return `${f} · le ${s.monthday === 1 ? '1er' : s.monthday}${h ? `, ${h}` : ''}`;
  return `${f} · ${CHECKIN_WEEKDAYS[s.weekday] || ''}${h ? ` ${h}` : ''}`;
}

// ── Préremplissage (app de l'élève) ────────────────────────

// Ce que l'app sait déjà pour la période du bilan [from, to] (ms). ctx :
//   weights : [{ date, kg }] (pesées, la plus récente d'abord), measures : { clé: [{ date, cm }] },
//   dietDays : [{ day, status }] (statut dietShareStatus des jours de la période, 'none' s'il n'y a rien de noté),
//   sessions : nombre de séances faites dans la période, planned : séances prévues (programme) dans la période,
//   steps : moyenne des pas par jour lue dans Santé, ou null (build sans la lecture des pas)
// → { values: { clé: valeur }, from: { clé: 'weight' | 'measures' | 'diet' | 'sessions' | 'health' } }
function checkinPrefill(items, ctx = {}) {
  const values = {}, from = {};
  for (const it of items || []) {
    if (it.kind === 'weight' && ctx.weights?.length) { const n = checkinNumber(ctx.weights[0].kg, 'kg'); if (n !== null) { values[it.key] = n; from[it.key] = 'weight'; } }
    if (it.kind === 'measures') {
      const m = {};
      for (const k of it.options?.keys || []) { const l = ctx.measures?.[k]; if (l?.length) { const n = checkinNumber(l[0].cm, 'cm'); if (n !== null) m[k] = n; } }
      if (Object.keys(m).length) { values[it.key] = m; from[it.key] = 'measures'; }
    }
    if (it.kind === 'diet_adherence' && ctx.dietDays?.length) {
      const noted = ctx.dietDays.length, ok = ctx.dietDays.filter(d => d.status === 'ok').length;
      if (noted) { values[it.key] = { done: ok, of: Math.min(31, noted) }; from[it.key] = 'diet'; }
    }
    if (it.kind === 'training_adherence' && Number.isInteger(ctx.sessions)) {
      const of = Math.min(31, Math.max(1, Number.isInteger(ctx.planned) && ctx.planned > 0 ? ctx.planned : ctx.sessions || 1));
      values[it.key] = { done: Math.min(of, ctx.sessions), of }; from[it.key] = 'sessions';
    }
    if (it.kind === 'steps' && Number.isFinite(ctx.steps)) { const n = checkinNumber(ctx.steps, 'steps'); if (n !== null) { values[it.key] = n; from[it.key] = 'health'; } }
  }
  return { values, from };
}

// ── Nettoyage de ce que rend le serveur ────────────────────

const checkinTs = v => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
// Une demande (élève ou coach) : items figés au moment de l'envoi, réponses, retour du coach
function cleanCheckinRequest(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !CHECKIN_UUID_RE.test(raw.id)) return null;
  const items = checkinItemsClean(raw.items);
  const answers = {};
  const src = raw.answers && typeof raw.answers === 'object' ? raw.answers : {};
  for (const it of items) { const v = Object.hasOwn(src, it.key) ? checkinValueClean(it, src[it.key]) : undefined; if (v !== undefined) answers[it.key] = v; }
  const rv = raw.review && typeof raw.review === 'object' ? raw.review : null;
  return {
    id: raw.id, student: typeof raw.student_id === 'string' ? raw.student_id : null, coach: typeof raw.coach_id === 'string' ? raw.coach_id : null,
    template: typeof raw.template_id === 'string' ? raw.template_id : null,
    name: checkinLine(raw.name, CHECKIN_NAME_MAX) || 'Bilan', items,
    periodStart: typeof raw.period_start === 'string' && /^\d{4}-\d\d-\d\d$/.test(raw.period_start) ? raw.period_start : null,
    sentAt: checkinTs(raw.sent_at), dueAt: checkinTs(raw.due_at), answeredAt: checkinTs(raw.answered_at), cancelledAt: checkinTs(raw.cancelled_at),
    answers,
    review: rv ? { reply: checkinText(rv.reply, CHECKIN_REPLY_MAX), score: Number.isInteger(rv.score) && rv.score >= 1 && rv.score <= 10 ? rv.score : null,
      at: checkinTs(rv.reviewed_at), sent: rv.sent === true } : null,
  };
}
function cleanCheckinTemplate(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !CHECKIN_UUID_RE.test(raw.id)) return null;
  return { id: raw.id, name: checkinLine(raw.name, CHECKIN_NAME_MAX) || 'Bilan', items: checkinItemsClean(raw.items),
    version: Number.isInteger(raw.version) ? raw.version : 1, createdAt: checkinTs(raw.created_at), updatedAt: checkinTs(raw.updated_at) };
}
function cleanCheckinSchedule(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const freq = CHECKIN_FREQS.some(([k]) => k === raw.freq) ? raw.freq : null;
  if (!freq || typeof raw.template_id !== 'string') return null;
  const student = typeof raw.student_id === 'string' ? raw.student_id : null, group = typeof raw.group_id === 'string' ? raw.group_id : null;
  if (!student === !group) return null;
  const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  return { id: raw.id, template: raw.template_id, student, group, freq, weekday: int(raw.weekday, 0, 6, 0), monthday: int(raw.monthday, 1, 28, 1),
    send_hour: int(raw.send_hour, 0, 23, 18), timezone: typeof raw.timezone === 'string' ? raw.timezone : 'Europe/Paris',
    remind_after_h: int(raw.remind_after_h, 1, 168, null), due_after_h: int(raw.due_after_h, 1, 336, 48), paused: raw.paused === true, nextAt: checkinTs(raw.next_at) };
}
function cleanCheckinGroup(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  return { id: raw.id, name: checkinLine(raw.name, CHECKIN_GROUP_NAME_MAX) || 'Groupe', members: Array.isArray(raw.members) ? raw.members.filter(x => typeof x === 'string') : [] };
}

// ── Modèles fournis (point de départ, le coach les adapte) ──

const CHECKIN_STARTERS = Object.freeze([
  { name: 'Hebdo', freq: 'week', kinds: ['weight', 'measures', 'diet_adherence', 'training_adherence', 'steps', 'sleep', 'energy', 'hunger', 'stress', 'pain'],
    questions: [{ type: 'text', label: 'Ta plus grande difficulté cette semaine ?' }] },
  { name: 'Complet du mois', freq: 'month', kinds: ['weight', 'measures', 'photos', 'diet_adherence', 'training_adherence', 'steps', 'cardio', 'pain', 'sleep', 'energy', 'hunger', 'stress', 'digestion', 'fatigue', 'mood'],
    questions: [{ type: 'text', label: 'Ce qui a le mieux marché ce mois-ci ?' }, { type: 'text', label: 'Ce que tu veux changer le mois prochain ?' }] },
  { name: 'Express', freq: 'manual', kinds: ['weight', 'energy', 'stress'], questions: [] },
]);
// Suivis d'un modèle fourni (clés des questions tirées par rand)
function checkinStarterItems(starter, rand = Math.random) {
  return checkinItemsClean([...starter.kinds.map(checkinDefaultItem),
    ...starter.questions.map(q => ({ kind: 'custom', key: checkinNewKey(rand), type: q.type, label: q.label }))]);
}
