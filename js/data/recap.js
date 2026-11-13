// ═══════════════════════════════════════════════════════════
//  Récaps de la semaine, du mois et de l'année : logique pure
// ═══════════════════════════════════════════════════════════
'use strict';

// Tout ce que montrent les écrans « Ta semaine », « Ton mois » et « Bilan de l'année » (façon Apple
// Music Replay) est calculé ici, sans DOM ni dessin, à partir du seul historique : jamais un chiffre
// qui n'en vienne pas. Une donnée absente (pas de durée, aucun record, un seul jour…) donne null et
// l'écran correspondant n'existe pas. Testé par tests/unit/recap.mjs.
//
// Périodes : la semaine va du lundi 0 h au lundi suivant (jours du calendrier : weekStart, addDays,
// justes aux changements d'heure), le mois et l'année suivent le calendrier local.
// Clé d'une période (route, carte vue) : « w2026-10-19 » (lundi), « m2026-10 », « y2026 ».

const RECAP_KINDS = {
  week:  { title: 'Ta semaine',  prevTo: 'à la semaine d\'avant', prev: 'la semaine d\'avant', color: 'var(--indigo)' },
  month: { title: 'Ton mois',    prevTo: 'au mois d\'avant',      prev: 'le mois d\'avant',    color: 'var(--teal)' },
  year:  { title: 'Ton année',   prevTo: 'à l\'année d\'avant',   prev: 'l\'année d\'avant',   color: 'var(--orange)' },
};
const RECAP_KEY_RE = /^(w\d{4}-\d{2}-\d{2}|m\d{4}-\d{2}|y\d{4})$/;
const RECAP_CARD_MONDAY_UNTIL = 12;   // la carte « Ta semaine » reste le lundi jusqu'à midi
const RECAP_YEAR_FROM_MONTH  = 11;   // « Bilan de l'année » de l'année en cours : à partir du 1er décembre
const RECAP_OTHER_RECORDS    = 3;    // autres records listés sous le plus marquant (écran et image), puis « et N autres »

// Références de date qui ne changent pas : les noms des jours et des mois viennent d'Intl (fr-FR)
const RECAP_DAY_NAME   = i => new Date(2024, 0, 1 + i).toLocaleDateString('fr-FR', { weekday: 'long' });   // le 1er janvier 2024 est un lundi
const RECAP_MONTH_NAME = m => new Date(2024, m, 1).toLocaleDateString('fr-FR', { month: 'long' });
const recapCap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ── Périodes ────────────────────────────────────────────────

// Période (semaine, mois ou année) qui contient l'instant ts : { kind, start, end, key, title, label, short }
// label : « 19 – 25 octobre », « 28 septembre – 4 octobre 2025 », « Octobre 2026 », « 2026 »
// short : même chose en abrégé pour une cellule (« 19 – 25 oct. », « Oct. 2026 »)
function recapPeriod(kind, ts = Date.now(), now = Date.now()) {
  const d = new Date(ts), y = d.getFullYear(), m = d.getMonth();
  const thisYear = new Date(now).getFullYear();
  let start, end, key, label, short;
  if (kind === 'week') {
    start = weekStart(ts); end = addDays(start, 7);
    key = 'w' + localISO(start);
    const a = new Date(start), b = new Date(addDays(start, 6));
    const yr = b.getFullYear() !== thisYear ? ` ${b.getFullYear()}` : '';
    const day = (x, style) => x.toLocaleDateString('fr-FR', { day: 'numeric', ...(style ? { month: style } : {}) });
    label = a.getMonth() === b.getMonth() ? `${day(a)} – ${day(b, 'long')}${yr}` : `${day(a, 'long')} – ${day(b, 'long')}${yr}`;
    short = a.getMonth() === b.getMonth() ? `${day(a)} – ${day(b, 'short')}${yr}` : `${day(a, 'short')} – ${day(b, 'short')}${yr}`;
  } else if (kind === 'month') {
    start = new Date(y, m, 1).getTime(); end = new Date(y, m + 1, 1).getTime();
    key = `m${y}-${pad(m + 1)}`;
    label = recapCap(new Date(start).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
    short = recapCap(new Date(start).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }));
  } else {
    start = new Date(y, 0, 1).getTime(); end = new Date(y + 1, 0, 1).getTime();
    key = `y${y}`;
    label = short = String(y);
  }
  return { kind, start, end, key, title: RECAP_KINDS[kind].title, label, short };
}

// Période désignée par sa clé (route « recap:w2026-10-19 »), null si la clé est illisible
function recapPeriodFromKey(key, now = Date.now()) {
  if (!RECAP_KEY_RE.test(String(key))) return null;
  const kind = { w: 'week', m: 'month', y: 'year' }[key[0]];
  const [y, m = 1, d = 1] = key.slice(1).split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const p = recapPeriod(kind, new Date(y, m - 1, d, 12).getTime(), now);
  return p.key === key ? p : null;   // « w2026-10-20 » (un mardi) n'est pas une clé de semaine
}

// Période de même nature juste avant
function recapPrevPeriod(p, now = Date.now()) { return recapPeriod(p.kind, addDays(p.start, -1), now); }

// Séances de l'historique dans la période, de la plus ancienne à la plus récente
function recapSessions(history, p) {
  return (history || []).filter(h => h && h.date >= p.start && h.date < p.end).sort((a, b) => a.date - b.date);
}

// ── Chiffres ────────────────────────────────────────────────

// Séances, durée totale (ms), volume (kg, règle de l'app : poids du corps compris) et séries de travail
// (échauffements exclus partout, comme le bilan : js/data/warmup.js)
function recapTotals(sessions) {
  return sessions.reduce((t, h) => {
    t.sessions++;
    t.duration += h.duration > 0 ? h.duration : 0;
    t.volume   += sessionVolume(h.exercises || [], entryBodyKg(h));
    t.sets     += (h.exercises || []).reduce((a, e) => a + workSets(e.sets).length, 0);
    return t;
  }, { sessions: 0, duration: 0, volume: 0, sets: 0 });
}

// Records battus pendant la période, un par exercice : les records notés dans chaque séance à
// l'enregistrement (entryRecords, js/data/records.js : charge, lest, reps, aide, temps, durée, distance,
// allure ; égaler n'est jamais battre, jamais le 1RM estimé), recalculés avec les mêmes règles pour une
// séance d'avant les records notés. Ce sont donc exactement ceux du bilan, de l'image de la séance et des
// badges en direct. Par exercice, le plus marquant (type, puis meilleure valeur) ; du plus marquant au moins.
// Chaque record garde d'où il part (before : la valeur d'avant du premier record de la même sorte dans la
// période, sur la même séance type, « 50 → 57,5 kg » sur la semaine) et, en charge ou en lest, la courbe de
// la meilleure série séance après séance (curve), pour l'écran « avant → après ».
function recapRecords(sessions, history) {
  const by = new Map();   // exercice (nom normalisé, comme les records notés) → [{ r, h, ex }] dans l'ordre
  sessions.forEach(h => {
    entryRecords(h, history).forEach(r => {
      // L'exercice de la séance qui fait ce record (même nom), avec sa série
      const ex = (h.exercises || []).find(e => sameExerciseName(e.name, r.ex) && notedRecordSet(e, r));
      if (!ex) return;
      const k = normName(r.ex);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ r, h, ex });
    });
  });
  const out = [...by.entries()].map(([key, list]) => {
    const best = list.reduce((b, x) => (recapBetterRecord(x.r, b.r) ? x : b));
    const { r, h, ex } = best;
    const set = notedRecordSet(ex, r);
    const first = list.find(x => recapSameLine(x, best)) || best;
    const from = first.r.before;
    return { key, name: ex.name, kind: r.kind, label: notedLabel(r), rec: r,
      value: recapRecordValue(r, ex, set), w: parseFloat(set.weight) || 0, r: parseInt(set.reps) || 0,
      rank: NOTED_RANK[r.kind] || 0, date: h.date,
      before: from == null ? null : { value: from, date: recapBeforeDate(first.h, first.ex, first.r, history) },
      curve: recapCurve(history, h, ex, r) };
  });
  out.forEach(x => { x.rel = recapRecordRel(x); });
  return out.sort((a, b) => b.rank - a.rank || recapRelOrder(b) - recapRelOrder(a) || recapRecordWeight(b) - recapRecordWeight(a) || b.date - a.date);
}
// Hausse relative d'un record sur la période (0,04 = +4 %), depuis son point de départ (before) ; null sans
// point de départ. Moins d'aide et une allure plus rapide comptent comme des hausses.
// Pourquoi relative : en absolu, l'exercice le plus lourd gagnerait presque toujours (+5 kg à la presse
// contre +1 kg au curl, alors que le curl a progressé deux fois plus). Le type passe avant (une charge avant
// des répétitions) : « Ta plus forte hausse de charge » reste vrai même si une ligne de reps fait plus.
function recapRecordRel(rec) {
  const b = rec.before?.value, a = rec.rec.after;
  const down = rec.kind === 'aide' || rec.kind === 'allure';
  if (b == null || !(b > 0) || !(a > 0 || (rec.kind === 'aide' && a === 0))) return null;   // plus d'aide du tout : +100 %
  const rel = (down ? b - a : a - b) / b;
  return rel > 0 ? rel : null;
}
const recapRelOrder = x => (x.rel == null ? -1 : x.rel);
// Meilleur de deux records du même exercice : type le plus marquant, puis meilleure valeur (moins d'aide,
// allure la plus rapide sur la plus longue distance fixe, sinon la plus grande valeur)
function recapBetterRecord(a, b) {
  if (NOTED_RANK[a.kind] !== NOTED_RANK[b.kind]) return NOTED_RANK[a.kind] > NOTED_RANK[b.kind];
  if (a.kind !== b.kind) return false;
  if (a.kind === 'allure') return a.d > b.d || (a.d === b.d && a.after < b.after);
  return a.kind === 'aide' ? a.after < b.after : a.after > b.after;
}
// Même sorte de record sur la même séance type (programme et séance) : même type, même distance fixe,
// même charge pour un record de reps. Sert à trouver d'où part le record sur la période.
function recapSameLine(x, best) {
  return x.r.kind === best.r.kind && x.r.d === best.r.d && x.r.w === best.r.w
    && entryProg(x.h) === entryProg(best.h) && x.h.category === best.h.category;
}
// Ordre des records de même type : les plus lourds d'abord, puis le plus de reps
function recapRecordWeight(x) { return x.w * 1e3 + x.r; }
// Texte d'un record dans une liste (« 62,5 kg × 6 », « 5 km à 4:50 /km », « 45 min ») : la série elle-même
// en force, la valeur du record ailleurs
function recapRecordValue(r, ex, set) {
  if (['charge', 'lest', 'reps', 'aide'].includes(r.kind)) return setTxt(bestSet([set], ex), ex);
  return r.kind === 'allure' ? `${recordDistTxt(r.d)} à ${notedValueTxt(r)}` : notedValueTxt(r);
}

// Séances d'avant `cut` où l'exercice compte pour ses records (même programme, même séance)
function recapSameSlot(entry, ex, history, cut) {
  const prog = entryProg(entry);
  return (history || []).filter(h => h && h !== entry && h.date < cut && entryProg(h) === prog && h.category === entry.category
    && (h.exercises || []).some(e => sameEx(e, ex))).sort((a, b) => a.date - b.date);
}

// Date du record d'avant (r.before) : première séance d'avant où une série l'a fait, null sinon
function recapBeforeDate(entry, ex, r, history) {
  if (r.before == null) return null;
  const was = { ...r, after: r.before };
  const first = recapSameSlot(entry, ex, history, entry.date)
    .find(h => (h.exercises || []).some(e => sameEx(e, ex) && notedRecordSet(e, was)));
  return first ? first.date : null;
}

// Courbe d'un record de charge ou de lest : meilleure charge de chaque séance de l'exercice jusqu'au record
// compris (8 dernières), seulement s'il y a au moins 3 points et qu'elle monte
const RECAP_CURVE_MAX = 8;
function recapCurve(history, entry, ex, r) {
  if (!entry || !ex || !['charge', 'lest'].includes(r.kind) || !(r.after > 0)) return null;
  const pts = [...recapSameSlot(entry, ex, history, entry.date), entry].map(h => {
    const b = bestSet((h.exercises || []).filter(e => sameEx(e, ex)).flatMap(e => e.sets || []), ex);
    return b && b.w > 0 ? { date: h.date, w: b.w } : null;
  }).filter(Boolean).slice(-RECAP_CURVE_MAX);
  return pts.length >= 3 && pts.at(-1).w > pts[0].w ? pts : null;
}

// Textes de l'écran record : { from, to, unit, sub, gain } (« 50 » → « 57,5 » kg, « × 10 répétitions »,
// « +7,5 kg depuis ton record du 21 septembre »). Sans valeur d'avant, from et gain sont vides.
const recapRound = v => Math.round(v * 100) / 100;
const recapPaceNum = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
// Gain d'un record seul, sans date (« +5 kg », « +2 répétitions », « −9 secondes au km », « −5 kg d'aide ») ;
// '' sans point de départ
function recapRecordGain(rec) {
  const u = unitLbl(), r = rec.rec, b = rec.before?.value ?? null;
  if (b == null) return '';
  const kg = v => `${fmtW(recapRound(v))} ${u}`;
  switch (r.kind) {
    case 'reps':     return `+${plural(r.after - b, 'répétition', 'répétitions')}`;
    case 'lest':     return `+${kg(r.after - b)}`;   // lest parti de 0 compris (« +10 kg »)
    case 'aide':     return `−${kg(b - r.after)} d'aide`;
    case 'temps':    return `+${fmtSeconds(r.after - b)}`;
    case 'duree':    return `+${fmtNum(recapRound(r.after - b))} min`;
    case 'distance': return `+${fmtNum(recapRound(r.after - b))} km`;
    case 'allure':   return `−${plural(b - r.after, 'seconde', 'secondes')} ${ROW_RECORD_KM.includes(r.d) ? 'aux 500 m' : 'au km'}`;
  }
  return b > 0 ? `+${kg(r.after - b)}` : '';   // charge
}
// Gain et hausse en pourcentage (« +5 kg (+4 %) ») : le pourcentage dit pourquoi un record passe devant un
// autre (recapRecordRel) ; seulement à partir de 1 %
function recapGainPct(rec) {
  const g = recapRecordGain(rec), pct = rec.rel == null ? 0 : Math.round(rec.rel * 100);
  const down = rec.kind === 'aide' || rec.kind === 'allure';   // pas « −5 kg d'aide (+25 %) » : signes contraires
  return g && pct >= 1 && !down ? `${g} (+${pct} %)` : g;
}
function recapRecordTexts(rec) {
  const u = unitLbl(), r = rec.rec, b = rec.before?.value ?? null, has = b != null;
  const day = ts => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const since = rec.before?.date ? ` depuis ton record du ${day(rec.before.date)}` : '';
  const g = recapRecordGain(rec), gain = g ? `${g}${since}` : '';   // même gain que la liste (recapRecordGain)
  const reps = `× ${plural(rec.r, 'répétition', 'répétitions')}`;
  const kg = v => `${fmtW(recapRound(v))} ${u}`;
  switch (r.kind) {
    case 'reps': {
      const k = loadKind({ name: rec.name });
      const sub = !(r.w > 0) ? 'au poids du corps' : k === 'lest' ? `avec +${kg(r.w)}` : k === 'aide' ? `avec ${kg(r.w)} d'aide` : `à ${kg(r.w)}`;
      return { from: has ? String(b) : '', to: String(r.after), unit: 'reps', sub, gain, since };
    }
    case 'lest':
      return { from: has && b > 0 ? fmtW(b) : '', to: fmtW(r.after), unit: u, sub: `de lest ${reps}`, gain, since };
    case 'aide':
      return { from: has ? fmtW(b) : '', to: fmtW(r.after), unit: u, sub: `d'aide ${reps}`, gain, since };
    case 'temps':
      return { from: has ? fmtSeconds(b) : '', to: fmtSeconds(r.after), unit: '', sub: r.w > 0 ? `avec +${kg(r.w)}` : 'tenu', gain, since };
    case 'duree':
      return { from: has ? fmtNum(b) : '', to: fmtNum(r.after), unit: 'min', sub: '', gain, since };
    case 'distance':
      return { from: has ? fmtNum(b) : '', to: fmtNum(r.after), unit: 'km', sub: '', gain, since };
    case 'allure': {
      const split = ROW_RECORD_KM.includes(r.d);
      // Unité en légende : « 5:00 → 4:51 /km » déborde sur un iPhone SE
      return { from: has ? recapPaceNum(b) : '', to: recapPaceNum(r.after), unit: '', sub: `${split ? 'aux 500\u00a0m' : 'au km'}, sur ${recordDistTxt(r.d)}`, gain, since };
    }
  }
  // Charge
  return { from: has && b > 0 ? fmtW(b) : '', to: fmtW(r.after), unit: u, sub: rec.r ? reps : '', gain, since };
}

// Exercice le plus pratiqué : présent (au moins une série faite) dans le plus de séances, puis le plus
// de séries. Rien s'il n'apparaît que dans une seule séance : « le plus fait » n'aurait aucun sens.
function recapTopExercise(sessions) {
  const by = new Map();
  sessions.forEach(h => {
    const seen = new Set();
    (h.exercises || []).forEach(e => {
      const n = workSets(e.sets).filter(s => (parseInt(s?.reps) || 0) > 0).length;   // échauffement exclu
      if (!n) return;
      const k = exKey(e);
      const it = by.get(k) || { key: k, name: e.name, sessions: 0, sets: 0 };
      it.name = e.name; it.sets += n;
      if (!seen.has(k)) { it.sessions++; seen.add(k); }
      by.set(k, it);
    });
  });
  const top = [...by.values()].sort((a, b) => b.sessions - a.sessions || b.sets - a.sets)[0];
  return top && top.sessions >= 2 ? top : null;
}

// Muscle le plus travaillé : séries pondérées (principal 1, secondaire ½ : muscleSetCounts), arrondies
// comme partout (roundSets). Null sans muscle reconnu.
function recapTopMuscle(history, p) {
  const { counts } = muscleSetCounts(history, p.start, p.end);
  let top = null;
  MUSCLES.forEach(({ id }) => { if (counts[id] > 0 && (!top || counts[id] > counts[top])) top = id; });
  const sets = top ? roundSets(counts[top]) : 0;
  return sets >= 1 ? { id: top, label: muscleLabel(top), sets } : null;
}

// Valeur la plus fréquente d'une répartition, seulement si elle revient au moins deux fois et qu'elle
// est seule en tête (à égalité, il n'y a pas de favori)
function recapFavourite(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length || entries[0][1] < 2 || (entries[1] && entries[1][1] === entries[0][1])) return null;
  return { key: entries[0][0], count: entries[0][1] };
}

// Jour de la semaine favori : { index (lundi 0), label (« mardi »), count } ou null
function recapFavDay(sessions) {
  const counts = {};
  sessions.forEach(h => { const i = dayIndexInWeek(recapStartOf(h)); counts[i] = (counts[i] || 0) + 1; });   // jour du début, comme le moment
  const fav = recapFavourite(counts);
  return fav ? { index: +fav.key, label: RECAP_DAY_NAME(+fav.key), count: fav.count } : null;
}

// Moment de la journée favori (séances chronométrées seulement : une séance passée saisie après coup
// n'a pas d'heure) : { slot, label (« le soir »), from, to (heure de début : 18 → 23), count, of (séances
// chronométrées) } ou null. Toujours montré avec sa plage et son compte : « le soir » seul ne dit ni de
// quelle heure à quelle heure, ni combien de fois.
const RECAP_SLOTS = [
  ['matin', 'le matin', 5, 12], ['midi', 'le midi', 12, 14], ['apres-midi', 'l\'après-midi', 14, 18],
  ['soir', 'le soir', 18, 23], ['nuit', 'la nuit', 23, 5],
];
// Heure de début d'une séance : la date d'une séance enregistrée est sa fin (summary.js, comme
// health-workouts.js), le début est donc date − durée
const recapStartOf = h => h.date - (h.duration > 0 ? h.duration : 0);
function recapSlotOf(ts) {
  const h = new Date(ts).getHours();
  return (RECAP_SLOTS.find(([, , a, b]) => h >= a && h < b) || RECAP_SLOTS.at(-1))[0];
}
function recapFavSlot(sessions) {
  const counts = {}, timed = sessions.filter(h => h.duration > 0);
  timed.forEach(h => { const s = recapSlotOf(recapStartOf(h)); counts[s] = (counts[s] || 0) + 1; });
  const fav = recapFavourite(counts);
  if (!fav) return null;
  const [, label, from, to] = RECAP_SLOTS.find(s => s[0] === fav.key);
  return { slot: fav.key, label, from, to, count: fav.count, of: timed.length, all: sessions.length };
}
// « Entre 18 h et 23 h » (heure de début des séances)
function recapSlotRange(slot) { return `Entre ${slot.from} h et ${slot.to} h`; }
// [« Plutôt le soir », « Entre 18 h et 23 h · 8 séances sur 11 »]
// Si des séances n'ont pas d'heure (saisies après coup), le compte le dit : « 6 séances sur 7 chronométrées »,
// pour ne pas contredire le « 4 séances sur 9 » du jour favori juste dessous
const recapTimedOf = (of, all) => `sur\u00a0${of}${all != null && of < all ? ' chronométrées' : ''}`;
function recapSlotLine(slot) { return [`Plutôt ${slot.label}`, `${recapSlotRange(slot)} · ${slot.count} séances ${recapTimedOf(slot.of, slot.all)}`]; }

// Semaines consécutives avec au moins une séance (tout l'historique compte, pas seulement la période) :
// current : série qui se termine à la dernière semaine de la période (« 6 semaines d'affilée ») ;
// longest : plus longue série parmi les semaines que la période recouvre
function recapStreak(history, p) {
  const weeks = new Set((history || []).map(h => weekStart(h.date)));
  let current = 0;
  for (let w = weekStart(p.end - 1); weeks.has(w); w = addDays(w, -7)) current++;
  let longest = 0, run = 0;
  for (let w = weekStart(p.start); w < p.end; w = addDays(w, 7)) {
    run = weeks.has(w) ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return { current, longest };
}

// Écarts avec la période précédente, null si elle n'a aucune séance (rien à comparer)
function recapCompare(cur, prev) {
  if (!prev || !prev.sessions) return null;
  return { sessions: cur.sessions - prev.sessions, duration: cur.duration - prev.duration, volume: cur.volume - prev.volume, sets: cur.sets - prev.sets };
}

// Année : séances par mois (12 cases) et mois le plus actif
function recapMonths(sessions) {
  const months = Array(12).fill(0);
  sessions.forEach(h => { months[new Date(h.date).getMonth()]++; });
  let top = -1;
  months.forEach((n, m) => { if (n > 0 && (top < 0 || n > months[top])) top = m; });
  return { months, topMonth: top < 0 ? null : { m: top, label: recapCap(RECAP_MONTH_NAME(top)), count: months[top] } };
}

// ── Profil, régularité, premières fois, progression ─────────

// Grands groupes du profil (« Jambes d'abord ») : regroupement des muscles de MUSCLES
const RECAP_GROUPS = [
  ['legs', 'Jambes', ['quads', 'hamstrings', 'glutes', 'adductors', 'calves']],
  ['chest', 'Pectoraux', ['chest']],
  ['back', 'Dos', ['lats', 'traps', 'lower_back']],
  ['shoulders', 'Épaules', ['front_delts', 'side_delts', 'rear_delts']],
  ['arms', 'Bras', ['biceps', 'brachialis', 'triceps', 'forearms']],
  ['core', 'Abdos', ['abs', 'obliques']],
];
const RECAP_FOCUS_SHARE = 0.3;    // un groupe « d'abord » : au moins 30 % des séries et seul en tête
const RECAP_ALL_BODY = { groups: 4, share: 0.12, max: 0.3 };   // « Tout le corps » : 4 groupes à 12 % ou plus, aucun à 30 %
const RECAP_EARLY_HOUR = 8;       // « Lève-tôt » : toutes les séances chronométrées commencées avant 8 h

// Profil de la période, composé uniquement de faits : { title, lines: [[libellé, valeur]], levels, muscles }
// title : ce qui a été travaillé (« Jambes d'abord », « Tout le corps », « Quadriceps en tête »), jamais une
// formule à décoder ; le moment et le jour viennent en lignes, chacune avec sa preuve (« Plutôt le soir ·
// Entre 18 h et 23 h · 8 séances sur 11 », « Le jeudi le plus souvent · 3 séances sur 11 ») ; levels :
// intensité 0..1 par muscle (personnage de l'ouverture) ; muscles : les 3 plus travaillés { id, label, sets } ;
// tiers : palier de Progrès / MUSCLE_LEVEL_MAX par muscle (personnage du profil) ; perWeekAvg : moyenne par semaine.
// null sans muscle ni moment favori.
function recapProfile(history, p, sessions, favSlot, favDay, now = Date.now()) {
  const { counts } = muscleSetCounts(history, p.start, p.end);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...Object.values(counts));
  const levels = max ? Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0).map(([id, n]) => [id, n / max])) : {};
  const muscles = MUSCLES.map(m => m.id).filter(id => roundSets(counts[id]) >= 1)
    .sort((a, b) => counts[b] - counts[a]).slice(0, 3).map(id => ({ id, label: muscleLabel(id), sets: roundSets(counts[id]) }));
  const parts = [], lines = [];
  if (total > 0) {
    const groups = RECAP_GROUPS.map(([id, label, ms]) => ({ id, label, share: ms.reduce((a, m) => a + (counts[m] || 0), 0) / total }))
      .sort((a, b) => b.share - a.share);
    const [g1, g2] = groups;
    if (g1.share >= RECAP_FOCUS_SHARE && g1.share > g2.share) {
      parts.push(`${g1.label} d'abord`);
      lines.push([g1.label, `${Math.round(g1.share * 100)} % de tes séries`]);
    } else if (g1.share < RECAP_ALL_BODY.max && groups.filter(g => g.share >= RECAP_ALL_BODY.share).length >= RECAP_ALL_BODY.groups) {
      parts.push('Tout le corps');
      // Le titre dit déjà « Tout le corps » : la ligne dit pourquoi, en mots (pas « 4 groupes à plus de 12 % »)
      const even = groups.filter(g => g.share >= RECAP_ALL_BODY.share).map(g => g.label.toLocaleLowerCase('fr-FR'));
      lines.push(['Bien réparti', `${recapCap(even.slice(0, -1).join(', '))} et ${even.at(-1)} : chacun plus de ${Math.round(RECAP_ALL_BODY.share * 100)}\u00a0% de tes séries`]);
    }
  }
  const timed = sessions.filter(h => h.duration > 0);
  if (timed.length >= 2 && timed.every(h => recapSlotOf(recapStartOf(h)) === 'matin' && new Date(recapStartOf(h)).getHours() < RECAP_EARLY_HOUR)) {
    lines.push(['Lève-tôt', `Toujours commencé avant ${RECAP_EARLY_HOUR} h · ${timed.length} séances ${recapTimedOf(timed.length, sessions.length)}`]);
  } else if (favSlot) lines.push(recapSlotLine(favSlot));
  if (favDay) lines.push([`Le ${favDay.label} le plus souvent`, `${favDay.count} séances sur ${sessions.length}`]);
  if (!parts.length && !muscles.length) return null;
  const title = parts.length ? parts[0] : `${muscles[0].label} en tête`;
  if (!parts.length) lines.unshift([muscles[0].label, plural(muscles[0].sets, 'série', 'séries')]);
  // Personnage du profil : paliers de Progrès (muscleLevel) sur la moyenne de séries par semaine, comptée en
  // jours de calendrier (la semaine du passage à l'heure d'hiver dure 169 h, pas 168) et seulement sur les
  // semaines couvertes : depuis la semaine de la première séance de la période, jusqu'à aujourd'hui au plus tard
  // (un bilan 2026 commencé en octobre ne se divise pas par 52). Séries arrondies d'abord, comme muscleLoad :
  // la couleur ne contredit jamais le chiffre lu sur les pastilles.
  const first = sessions.length ? Math.min(...sessions.map(recapStartOf)) : p.start;
  const from = Math.max(p.start, weekStart(first)), to = Math.min(p.end, now);
  const weeks = Math.max(1, Math.round((to - from) / 86400000) / 7);
  const tiers = Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, muscleLevel(roundSets(n) / weeks) / MUSCLE_LEVEL_MAX]).filter(([, v]) => v > 0));
  return { title, lines, levels, muscles, tiers, perWeekAvg: weeks > 1.5 };
}

const RECAP_STRIP_WEEKS = 8;   // frise de régularité de la semaine : les 8 dernières semaines

// Semaines de la période avec au moins une séance (année : « 41 semaines actives »)
function recapActiveWeeks(sessions) { return new Set(sessions.map(h => weekStart(h.date))).size; }

// Régularité de la semaine et du mois, mesurée à l'aune de la personne : son rythme habituel (objectif) est
// la médiane du nombre de séances de ses semaines actives (au moins une séance) sur les 8 semaines avant
// la période, arrondie à l'entier inférieur et jamais sous 2 (une séance par semaine n'est pas un
// rythme d'entraînement). Les semaines sans séance (vacances, maladie) n'abaissent pas l'objectif.
// On préfère l'historique au nombre de séances du programme : c'est ce que la personne tient vraiment.
// Semaines montrées : le mois, celles dont le jeudi tombe dans le mois (règle ISO : une semaine à cheval
// appartient au mois qui en a au moins 4 jours) ; la semaine, les 8 dernières. Chaque semaine compte toutes
// ses séances, du lundi au dimanche.
// { target, usual (médiane brute, pour dire si l'objectif a été relevé au minimum), weeks: [{ start, n, hit }],
// hit (semaines à l'objectif), total } ; null s'il n'y a pas 3 semaines actives pour fixer l'objectif, ou moins
// de 2 semaines à montrer.
const RECAP_REG_BASE_WEEKS = 8, RECAP_REG_MIN_BASE = 3, RECAP_REG_MIN_TARGET = 2;
function recapRegularity(history, p) {
  const count = new Map();
  (history || []).forEach(h => { if (h) { const w = weekStart(h.date); count.set(w, (count.get(w) || 0) + 1); } });
  const last = weekStart(p.end - 1);
  let first = addDays(last, -7 * (RECAP_STRIP_WEEKS - 1));
  if (p.kind === 'month') {
    first = weekStart(p.start);
    if (addDays(first, 3) < p.start) first = addDays(first, 7);
  }
  const shown = [];
  for (let w = first; w <= last; w = addDays(w, 7)) {
    if (p.kind === 'month' && addDays(w, 3) >= p.end) break;
    shown.push(w);
  }
  const anchor = p.kind === 'month' ? first : weekStart(p.start), base = [];
  for (let k = 1; k <= RECAP_REG_BASE_WEEKS; k++) { const n = count.get(addDays(anchor, -7 * k)) || 0; if (n) base.push(n); }
  if (base.length < RECAP_REG_MIN_BASE || shown.length < 2) return null;
  base.sort((a, b) => a - b);
  const mid = base.length / 2, median = base.length % 2 ? base[Math.floor(mid)] : (base[mid - 1] + base[mid]) / 2;
  const target = Math.max(RECAP_REG_MIN_TARGET, Math.floor(median));
  const weeks = shown.map(start => { const n = count.get(start) || 0; return { start, n, hit: n >= target }; });
  return { target, usual: median, weeks, hit: weeks.filter(w => w.hit).length, total: weeks.length };
}
// Régularité qui vaut d'être montrée : l'objectif tenu au moins une semaine sur deux (« 1 sur 5 » ne dit
// rien de bon, et le récap ne montre jamais de baisse)
const recapRegShown = reg => !!reg && reg.hit > 0 && reg.hit * 2 >= reg.total;
// L'objectif est exactement son rythme habituel (médiane entière, au-dessus du plancher) : sinon on dit « objectif »
const recapRegIsUsual = reg => reg.usual === reg.target;

const RECAP_MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
// Paliers de séances franchis pendant la période (10e, 25e, 50e, 100e… séance de tout l'historique), avec
// leur date : [{ n, date }], vide si aucun. Seulement des comptes exacts ; jamais de « nouvel exercice ».
function recapMilestones(history, p) {
  const all = (history || []).filter(h => h && h.date < p.end).sort((a, b) => a.date - b.date);
  const before = all.filter(h => h.date < p.start).length;
  return RECAP_MILESTONES.filter(n => n > before && n <= all.length).map(n => ({ n, date: all[n - 1].date }));
}

// Progression de l'exercice le plus fait sur un mois ou une année : 1RM estimé de sa meilleure série, première
// séance → dernière séance de la période ; seulement s'il monte. { from, to } en kg, sinon null.
// Seulement pour un exercice en charge et en répétitions : sur une machine assistée le poids est une aide
// (plus d'aide = moins fort), sur un exercice lesté le lest n'est pas « la charge soulevée » (comme setBeatsE1rm).
function recapExerciseProgress(sessions, top) {
  if (!top) return null;
  const e1s = sessions.map(h => {
    const ex = (h.exercises || []).filter(e => exKey(e) === top.key && measureOf(e) === 'reps' && loadKind(e) === 'charge');
    if (!ex.length) return null;
    return Math.max(0, ...ex.flatMap(e => workSets(e.sets)).map(s => calc1RM(s.weight, s.reps) || 0)) || null;
  }).filter(Boolean);
  if (e1s.length < 2 || !(e1s.at(-1) > e1s[0])) return null;
  return { from: e1s[0], to: e1s.at(-1) };
}

// Hausse du volume en pourcentage (entier ≥ 1), null si baisse, égalité ou rien à comparer
function recapVolumeGain(st) {
  if (!st.prev || !(st.prev.volume > 0)) return null;
  const pct = Math.round((st.volume - st.prev.volume) / st.prev.volume * 100);
  return pct >= 1 ? pct : null;
}

// Titre de la carte de l'accueil : le fait le plus positif (« 2 séances, 1 record battu »,
// « 3 séances, 6 semaines d'affilée », « 4 séances »)
function recapHeadline(st) {
  const head = plural(st.sessions, 'séance', 'séances');
  if (st.records.length) return `${head}, ${plural(st.records.length, 'record battu', 'records battus')}`;
  if (st.period.kind === 'week' && st.streak.current >= 2) return `${head}, ${st.streak.current} semaines d'affilée`;
  return head;
}

// Tout le récap d'une période, null si l'historique n'y contient aucune séance
function recapStats(p, history = data.history, now = Date.now()) {
  const sessions = recapSessions(history, p);
  if (!sessions.length) return null;
  const totals = recapTotals(sessions);
  const prevTotals = recapTotals(recapSessions(history, recapPrevPeriod(p, now)));
  const records = recapRecords(sessions, history);
  const st = {
    period: p, ...totals,
    records, bestRecord: records[0] || null,
    topExercise: recapTopExercise(sessions),
    topMuscle:   recapTopMuscle(history, p),
    favDay:      recapFavDay(sessions),
    favSlot:     recapFavSlot(sessions),
    streak:      recapStreak(history, p),
    prev:        prevTotals.sessions ? prevTotals : null,
    deltas:      recapCompare(totals, prevTotals),
  };
  if (p.kind === 'year') Object.assign(st, recapMonths(sessions));
  else st.regularity = recapRegularity(history, p);
  st.profile  = recapProfile(history, p, sessions, st.favSlot, st.favDay, now);
  st.activeWeeks = recapActiveWeeks(sessions);
  st.milestones = recapMilestones(history, p);
  st.progress = p.kind === 'week' ? null : recapExerciseProgress(sessions, st.topExercise);
  return st;
}

// ── Quand montrer quoi ──────────────────────────────────────

// Semaine que la carte de l'accueil propose : la semaine en cours tout le dimanche, la semaine passée le
// lundi jusqu'à midi ; null le reste du temps
function recapCardWeek(now = Date.now()) {
  const day = dayIndexInWeek(now);
  if (day === 6) return recapPeriod('week', now, now);
  if (day === 0 && new Date(now).getHours() < RECAP_CARD_MONDAY_UNTIL) return recapPeriod('week', addDays(now, -7), now);
  return null;
}

// Carte « Ta semaine » à afficher : { period, totals } ou null (réglage coupé, pas le moment, semaine
// sans séance, ou carte masquée : seenKey est la clé de la dernière semaine masquée par la croix)
function recapCardInfo({ history = data.history, now = Date.now(), seenKey = null, off = false } = {}) {
  if (off) return null;
  const p = recapCardWeek(now);
  if (!p || seenKey === p.key) return null;
  const totals = recapTotals(recapSessions(history, p));
  return totals.sessions ? { period: p, totals } : null;
}

// Listes de Progrès › Récaps, de la plus récente à la plus ancienne, chacune avec ses totaux :
// semaines terminées (et celle de la carte le dimanche), mois terminés, années (les précédentes,
// et celle en cours à partir du 1er décembre). Seulement celles qui ont au moins une séance.
function recapList({ history = data.history, now = Date.now() } = {}) {
  const hist = (history || []).filter(h => h && h.date < now);
  const withTotals = periods => periods.map(p => ({ period: p, totals: recapTotals(recapSessions(hist, p)) }))
    .filter(x => x.totals.sessions > 0);
  const uniq = ps => [...new Map(ps.map(p => [p.key, p])).values()].sort((a, b) => b.start - a.start);
  const card = recapCardWeek(now);
  const weeks = uniq(hist.map(h => recapPeriod('week', h.date, now)).filter(p => p.end <= now || (card && p.key === card.key)));
  const months = uniq(hist.map(h => recapPeriod('month', h.date, now)).filter(p => p.end <= now));
  const d = new Date(now), thisYear = d.getFullYear();
  const years = uniq(hist.map(h => recapPeriod('year', h.date, now)).filter(p => p.end <= now || (new Date(p.start).getFullYear() === thisYear && d.getMonth() >= RECAP_YEAR_FROM_MONTH)));
  return { weeks: withTotals(weeks), months: withTotals(months), years: withTotals(years) };
}

// ── Textes des écrans (déjà formatés, bruts : l'écran les passe par esc(), le canvas les écrit tels quels) ──

// « +1 séance par rapport à la semaine d'avant », « −12 min par rapport au mois d'avant », « comme l'année d'avant »
function recapDeltaText(kind, field, delta) {
  const k = RECAP_KINDS[kind];
  const sign = delta > 0 ? '+' : '−', abs = Math.abs(delta);
  let txt;
  if (field === 'duration') txt = abs < 60_000 ? '' : fmtDuration(abs);
  else if (field === 'volume') txt = Math.round(abs) === 0 ? '' : fmtVolume(abs);
  else if (field === 'sets') txt = abs ? plural(abs, 'série', 'séries') : '';
  else txt = abs ? plural(abs, 'séance', 'séances') : '';
  return txt ? `${sign}${txt} par rapport ${k.prevTo}` : `comme ${k.prev}`;
}

// « 4 séances », « 1 séance » → [valeur, légende]
function recapCountParts(n, one, many) { return [String(n), n > 1 ? many : one]; }

// Chiffre et unité jamais séparés en fin de ligne (« 16,1 t », « 1 h 57 »)
function recapNb(s) { return String(s ?? '').replace(/ /g, ' '); }

// Couleur de chaque écran (css/recap.css, js/features/recap-canvas.js), direction « sobre » : deux aplats.
//   accent : l'orange MDLF, chiffres de la période (séances, volume, régularité) et résumé
//   night  : le noir, faits mis en avant (profil, muscles, records, exercice, palier)
const RECAP_SPAN = { week: 'cette semaine', month: 'ce mois-ci', year: 'cette année' };
const RECAP_MINE = { week: 'Ma semaine', month: 'Mon mois', year: 'Mon année' };
const RECAP_SUMMARY_LINES = 4;   // lignes du dernier écran (au-delà, l'image déborde)

// Date d'un fait dans le texte : « 4 octobre » (mois, année), « jeudi 15 octobre » (semaine)
function recapDay(ts, kind) {
  return new Date(ts).toLocaleDateString('fr-FR', { ...(kind === 'week' ? { weekday: 'long' } : {}), day: 'numeric', month: 'long' });
}

// Palier de séances franchi dans la semaine ou le mois (le plus haut), en une phrase : « Ce mois-ci : ta
// 25e séance depuis tes débuts, le 4 octobre » (« depuis tes débuts » : sous « 7 séances », « ta 25e
// séance » seul se lirait « du mois »). Il n'a plus d'écran à lui (il passait trop vite pour ce qu'il dit) ; seul le
// bilan de l'année garde l'écran « Ton palier ».
function recapMilestoneText(st) {
  const m = st.milestones.at(-1);
  return m ? `${recapCap(RECAP_SPAN[st.period.kind])} : ta ${m.n}e séance depuis tes débuts, le ${recapDay(m.date, st.period.kind)}` : '';
}

// Pourquoi le premier record est mis en avant, en une formule toujours vraie : les records sont classés par
// type (charge d'abord) puis par hausse en % (recapRecords). « Ta plus forte progression » seulement s'il a
// la plus forte hausse de tous ; sinon la plus forte de son type (« hausse de charge »), sinon le plus lourd.
function recapBestWhy(records) {
  const r = records[0], heavy = ['charge', 'lest'].includes(r.kind);
  if (r.rel != null && records.every(x => x.rel == null || x.rel <= r.rel)) return 'Ta plus forte progression';
  if (r.rel != null && heavy) return 'Ta plus forte hausse de charge';
  return heavy ? 'Ton record le plus lourd' : 'Ton record le plus marquant';
}

// Écrans du récap, dans l'ordre. Chacun : { id, tone, kicker, sub?, lead?, title?, value?, unit?, from?,
// caption?, note?, mention?, box?, foot?, curve?, strip?, stripNote?, bars?, pills?, body?, tiles?, list?,
// listTitle?, more?, share }. value : le chiffre fort (compté à l'arrivée) ; title : un texte fort (profil,
// nom d'exercice) ; lead : pourquoi ce fait est mis en avant. Chaque écran se comprend seul, en français
// courant. Rien n'est inventé : un écran sans donnée n'est pas produit, une comparaison n'apparaît que si
// elle est en hausse.
function recapPages(st) {
  if (!st) return [];
  const { period: p, deltas } = st, kind = p.kind;
  const kicker = p.title.toLocaleUpperCase('fr-FR');
  const span = RECAP_SPAN[kind], SPAN = span.toLocaleUpperCase('fr-FR');
  const reg = st.regularity;
  const pages = [];

  // 1. Ouverture : les séances (hausse seulement ; sinon la régularité) et le palier franchi
  const [n, nLbl] = recapCountParts(st.sessions, 'séance', 'séances');
  let note = deltas && deltas.sessions > 0 ? recapDeltaText(kind, 'sessions', deltas.sessions) : '';
  if (!note && recapRegShown(reg)) {
    note = kind === 'week'
      ? (reg.weeks.at(-1).hit ? `${reg.target} séances ou plus${recapRegIsUsual(reg) ? ', ton rythme habituel' : ' cette semaine'}` : '')
      : `${reg.hit} semaines sur ${reg.total} à ${reg.target} séances ou plus${recapRegIsUsual(reg) ? ', ton rythme habituel' : ''}`;
  }
  pages.push({ id: 'sessions', tone: 'accent', kicker, sub: p.label, value: n, caption: nLbl, note,
    mention: kind === 'year' ? '' : recapMilestoneText(st),
    chips: [st.duration >= 60_000 ? recapNb(fmtDuration(st.duration)) : '', st.records.length ? plural(st.records.length, 'record', 'records') : ''].filter(Boolean),
    body: st.profile && Object.keys(st.profile.levels).length ? st.profile.levels : null, share: 'Partager' });

  // Profil (année : « ton année en un corps »)
  const pr = st.profile;
  const profile = pr && {
    id: 'profile', tone: 'night', kicker: kind === 'year' ? 'TON ANNÉE EN UN CORPS' : `TON PROFIL ${SPAN}`,
    title: pr.title, lines: pr.lines, body: pr.tiers, scale: pr.perWeekAvg ? 'séries en moyenne par semaine' : 'séries par semaine', pills: pr.muscles.map(m => [m.label, plural(m.sets, 'série', 'séries')]), share: 'Partager mon profil' };

  // Volume (ou les séries quand rien n'est chargé), séries et durée en tuiles
  const gain = recapVolumeGain(st);
  const volume = st.volume > 0
    ? { id: 'volume', tone: 'accent', kicker, value: recapNb(fmtVolume(st.volume)), caption: `soulevées en ${plural(st.sessions, 'séance', 'séances')}`,
        note: gain ? `+${gain} % par rapport ${RECAP_KINDS[kind].prevTo}` : '',
        tiles: [['Séries', String(st.sets)], ...(st.duration >= 60_000 ? [['Durée', recapNb(fmtDuration(st.duration))]] : [])], share: 'Partager' }
    : { id: 'sets', tone: 'accent', kicker, value: String(st.sets), caption: st.sets > 1 ? 'séries' : 'série',
        note: deltas && deltas.sets > 0 ? recapDeltaText(kind, 'sets', deltas.sets) : '',
        tiles: st.duration >= 60_000 ? [['Durée', recapNb(fmtDuration(st.duration))]] : [], share: 'Partager' };

  // Records : celui qui a le plus progressé (recapRecordRel), dit comme tel, avant → après ; puis la liste
  // des autres avec leur gain. La courbe seulement quand il est seul (sinon la liste dit plus).
  let record = null;
  if (st.bestRecord) {
    const r = st.bestRecord, t = recapRecordTexts(r), many = st.records.length > 1, day = recapDay(r.date, kind);
    const lead = many ? recapBestWhy(st.records) : '';   // la période est dans le surtitre
    const rest = st.records.slice(1);
    record = { id: 'records', tone: 'night', kicker: many ? `${st.records.length} RECORDS ${SPAN}` : `NOUVEAU RECORD · ${day.toLocaleUpperCase('fr-FR')}`,
      lead, title: r.name, value: t.to, unit: t.unit, from: t.from,
      caption: t.sub,
      box: t.gain ? `${recapGainPct(r)}${t.since}` : '',
      curve: !many && r.curve ? r.curve.map(x => ({ date: x.date, w: x.w, label: new Date(x.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) })) : null,
      listTitle: rest.length ? (rest.length > 1 ? 'Tes autres records' : 'Ton autre record') : '',
      list: rest.slice(0, RECAP_OTHER_RECORDS).map(x => ({ name: x.name, value: recapNb(x.value), gain: recapGainPct(x) })),
      more: rest.length > RECAP_OTHER_RECORDS ? `et ${plural(rest.length - RECAP_OTHER_RECORDS, 'autre record', 'autres records')}` : '',
      share: 'Partager ce record' };
  }

  // Exercice le plus fait (mois, année : progression de la force estimée, expliquée)
  const top = st.topExercise;
  const ex = top && { id: 'exercise', tone: 'night', kicker: 'TON EXERCICE LE PLUS FAIT', title: top.name,
    caption: `dans ${top.sessions} séances sur ${st.sessions} · ${plural(top.sets, 'série', 'séries')}`,
    box: st.progress ? `Force estimée : ${fmtW(st.progress.from)} → ${fmtW(st.progress.to)} ${unitLbl()}` : '',
    foot: st.progress ? 'La charge que tu pourrais soulever une seule fois, calculée d\'après tes séries' : '', share: 'Partager' };

  // Régularité. Semaine, mois : semaines à son rythme habituel (recapRegularity), frise du nombre de séances
  // de chaque semaine ; rien si aucune semaine ne l'atteint (jamais de baisse). Année : semaines actives et
  // séances par mois.
  let streak = null;
  if (kind === 'year') {
    streak = { id: 'streak', tone: 'accent', kicker: 'TA RÉGULARITÉ', value: String(st.activeWeeks), caption: st.activeWeeks > 1 ? 'semaines actives' : 'semaine active',
      note: st.streak.longest >= 2 ? `Plus longue série : ${st.streak.longest} semaines d'affilée` : '',
      bars: st.months ? { values: st.months, top: st.topMonth ? st.topMonth.m : -1 } : null,
      box: st.topMonth ? `${st.topMonth.label}, ton mois le plus actif : ${plural(st.topMonth.count, 'séance', 'séances')}` : '', share: 'Partager' };
  } else if (recapRegShown(reg)) {
    const short = ts => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    streak = { id: 'streak', tone: 'accent', kicker: 'TA RÉGULARITÉ', value: String(reg.hit), unit: kind === 'week' ? '' : `sur ${reg.total}`,
      caption: kind === 'week' ? `semaines sur les ${reg.total} dernières avec ${reg.target} séances ou plus` : `semaines avec ${reg.target} séances ou plus`,
      note: recapRegIsUsual(reg)
        ? `Ton rythme habituel les 2 mois d'avant : ${reg.target} séances par semaine`
        : `Objectif : ${reg.target} séances par semaine (ton rythme habituel les 2 mois d'avant : ${fmtNum(reg.usual)})`,
      strip: reg.weeks.map(w => ({ n: w.n, on: w.hit, label: short(w.start) })),
      stripNote: `Séances de chaque semaine, du lundi au dimanche. Rempli : ${reg.target} séances ou plus.`, share: 'Partager' };
  }

  // Palier de séances (année seulement : semaine et mois le disent à l'ouverture) : le plus haut en grand,
  // les autres en liste (du plus récent au plus ancien)
  let milestone = null;
  if (kind === 'year' && st.milestones.length) {
    const m = st.milestones.at(-1);
    milestone = { id: 'milestone', tone: 'night', kicker: 'TON PALIER', value: `${m.n}e`, caption: `séance, le ${recapDay(m.date, kind)}`,
      list: st.milestones.slice(0, -1).reverse().slice(0, 4).map(x => ({ name: `${x.n}e séance`, value: recapDay(x.date, kind) })), share: 'Partager' };
  }

  // Petite période (1 ou 2 séances) : le record et la régularité d'abord, le volume ensuite
  const order = st.sessions <= 2 ? [record, streak, profile, volume, ex, milestone] : [profile, volume, record, ex, streak, milestone];
  order.forEach(pg => { if (pg) pages.push(pg); });
  pages.push(recapSummaryPage(st));
  return pages;
}

// Dernier écran : la story elle-même, « Mon mois en bref » (c'est l'image que la personne publie, d'où le
// « mon »). Les chiffres en tuiles, chacune avec son nom, puis des lignes dont le libellé dit ce qu'elles
// sont (« Exercice le plus fait », « Plus forte progression »…), jamais une formule à décoder.
function recapSummaryPage(st) {
  const { period: p } = st, kind = p.kind, reg = st.regularity;
  const tiles = [];
  if (st.volume > 0) tiles.push(['Volume soulevé', recapNb(fmtVolume(st.volume))]);
  tiles.push([st.sessions > 1 ? 'Séances' : 'Séance', String(st.sessions)]);
  if (st.duration >= 60_000) tiles.push(['Durée', recapNb(fmtDuration(st.duration))]);
  if (st.records.length) tiles.push([st.records.length > 1 ? 'Records' : 'Record', String(st.records.length)]);
  tiles.push(['Séries', String(st.sets)]);
  const lines = [];
  if (st.topExercise) lines.push(['Exercice le plus fait', st.topExercise.name]);
  const r = st.bestRecord;
  if (r) {
    const why = recapCap(recapBestWhy(st.records).replace(/^(Ta|Ton) /, ''));   // « Plus forte progression », « Record le plus lourd »
    lines.push([why, `${r.name} · ${r.rel != null ? recapGainPct(r) : recapNb(r.value)}`]);   // le libellé court tient sur une ligne
  }
  if (kind === 'year' && st.topMonth) lines.push(['Mois le plus actif', `${st.topMonth.label} · ${plural(st.topMonth.count, 'séance', 'séances')}`]);
  if (recapRegShown(reg)) lines.push([`Semaines à ${reg.target} séances ou plus`, `${reg.hit} sur ${reg.total}`]);
  if (st.favSlot) lines.push(['Moment préféré', `${recapCap(st.favSlot.label)}, ${recapSlotRange(st.favSlot).toLowerCase()}`]);
  const m = kind === 'year' && st.milestones.at(-1);   // semaine, mois : le palier est dit à l'ouverture
  if (m) lines.push(['Palier de séances', `${m.n}e séance, le ${recapDay(m.date, kind)}`]);
  if (st.topMuscle) lines.push(['Muscle le plus travaillé', st.topMuscle.label]);
  return { id: 'summary', tone: 'accent', kicker: p.label.toLocaleUpperCase('fr-FR'),
    title: `${RECAP_MINE[kind]} en bref`, tiles: tiles.slice(0, 4), lines: lines.slice(0, RECAP_SUMMARY_LINES),
    share: `Partager ${RECAP_MINE[kind].toLowerCase()}` };
}

// Description d'un écran pour VoiceOver et l'aperçu de l'image : la phrase entière, lue d'un trait.
function recapPageAlt(page, st) {
  const head = `${st.period.title}, ${st.period.label}`;
  const sp = s => String(s ?? '').replace(/[  ]/g, ' ');
  const parts = [];
  if (page.lead) parts.push(page.lead);
  if (page.title && page.id !== 'summary') parts.push(page.title);
  if (page.value) parts.push(page.from ? `${page.from} → ${page.value}${page.unit ? ` ${page.unit}` : ''}` : `${page.value}${page.unit ? ` ${page.unit}` : ''}${page.caption ? ` ${page.caption}` : ''}`);
  if (page.from || (!page.value && page.caption)) parts.push(page.caption);
  if (page.note) parts.push(recapCap(page.note));
  if (page.mention) parts.push(page.mention);
  if (page.box) parts.push(page.box);
  if (page.foot) parts.push(page.foot);
  if (page.lines) parts.push(page.lines.map(([l, v]) => `${l} : ${v}`).join('. '));
  if (page.pills?.length && page.id === 'profile') parts.push(`Muscles les plus travaillés : ${page.pills.map(([l, v]) => `${l} ${v}`).join(', ')}`);
  if (page.tiles?.length) parts.push(page.tiles.map(([l, v]) => `${l} ${v}`).join(', '));
  if (page.curve) parts.push(`Courbe de la meilleure charge : ${page.curve.map(x => `${x.label} ${fmtW(x.w)} ${unitLbl()}`).join(', ')}`);
  if (page.strip) parts.push(`Séances par semaine : ${page.strip.map(w => `semaine du ${w.label} ${w.n}`).join(', ')}`);
  if (page.list?.length) parts.push(`${page.listTitle ? `${page.listTitle} : ` : ''}${page.list.map(x => `${x.name} ${x.value}${x.gain ? ` ${x.gain}` : ''}`).join(', ')}`);
  if (page.more) parts.push(recapCap(page.more));
  const own = page.kicker === st.period.title.toLocaleUpperCase('fr-FR');
  const kick = page.id === 'summary' ? `${head} en bref` : own ? head : `${head}, ${page.kicker.toLocaleLowerCase('fr-FR')}`;
  return sp(`${kick} : ${parts.filter(Boolean).join('. ')}.`);
}

// Nom du fichier partagé : « mdlf-training-recap-w2026-10-19-volume.png »
function recapFileName(p, page) { return `mdlf-training-recap-${p.key}-${page.id}.png`; }
