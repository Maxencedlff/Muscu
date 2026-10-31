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
const RECAP_CARD_SUNDAY_HOUR = 18;   // la carte « Ta semaine » apparaît le dimanche à partir de 18 h
const RECAP_YEAR_FROM_MONTH  = 11;   // « Bilan de l'année » de l'année en cours : à partir du 1er décembre
const RECAP_MAX_RECORDS      = 5;    // records listés sur l'écran et l'image

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
      const ex = (h.exercises || []).find(e => normName(e.name) === normName(r.ex) && notedRecordSet(e, r));
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
  return out.sort((a, b) => b.rank - a.rank || recapRecordWeight(b) - recapRecordWeight(a) || b.date - a.date);
}
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
function recapRecordTexts(rec) {
  const u = unitLbl(), r = rec.rec, b = rec.before?.value ?? null, has = b != null;
  const day = ts => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const since = rec.before?.date ? ` depuis ton record du ${day(rec.before.date)}` : '';
  const reps = `× ${plural(rec.r, 'répétition', 'répétitions')}`;
  const kg = v => `${fmtW(recapRound(v))} ${u}`;
  switch (r.kind) {
    case 'reps': {
      const k = loadKind({ name: rec.name });
      const sub = !(r.w > 0) ? 'au poids du corps' : k === 'lest' ? `avec +${kg(r.w)}` : k === 'aide' ? `avec ${kg(r.w)} d'aide` : `à ${kg(r.w)}`;
      return { from: has ? String(b) : '', to: String(r.after), unit: 'reps', sub,
               gain: has ? `+${plural(r.after - b, 'répétition', 'répétitions')}${since}` : '' };
    }
    case 'lest':
      return { from: has && b > 0 ? fmtW(b) : '', to: fmtW(r.after), unit: u, sub: `de lest ${reps}`,
               gain: has ? `+${kg(r.after - b)}${since}` : '' };
    case 'aide':
      return { from: has ? fmtW(b) : '', to: fmtW(r.after), unit: u, sub: `d'aide ${reps}`,
               gain: has ? `−${kg(b - r.after)} d'aide${since}` : '' };
    case 'temps':
      return { from: has ? fmtSeconds(b) : '', to: fmtSeconds(r.after), unit: '', sub: r.w > 0 ? `avec +${kg(r.w)}` : 'tenu',
               gain: has ? `+${fmtSeconds(r.after - b)}${since}` : '' };
    case 'duree':
      return { from: has ? fmtNum(b) : '', to: fmtNum(r.after), unit: 'min', sub: '',
               gain: has ? `+${fmtNum(recapRound(r.after - b))} min${since}` : '' };
    case 'distance':
      return { from: has ? fmtNum(b) : '', to: fmtNum(r.after), unit: 'km', sub: '',
               gain: has ? `+${fmtNum(recapRound(r.after - b))} km${since}` : '' };
    case 'allure': {
      const split = ROW_RECORD_KM.includes(r.d);
      // Unité en légende : « 5:00 → 4:51 /km » déborde sur un iPhone SE
      return { from: has ? recapPaceNum(b) : '', to: recapPaceNum(r.after), unit: '', sub: `${split ? 'aux 500\u00a0m' : 'au km'}, sur ${recordDistTxt(r.d)}`,
               gain: has ? `−${plural(b - r.after, 'seconde', 'secondes')} ${split ? 'aux 500 m' : 'au km'}${since}` : '' };
    }
  }
  // Charge
  return { from: has && b > 0 ? fmtW(b) : '', to: fmtW(r.after), unit: u, sub: rec.r ? reps : '',
           gain: has && b > 0 ? `+${kg(r.after - b)}${since}` : '' };
}

// Exercice le plus pratiqué : présent (au moins une série faite) dans le plus de séances, puis le plus
// de séries. Rien s'il n'apparaît que dans une seule séance : « exercice n° 1 » n'aurait aucun sens.
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
  sessions.forEach(h => { const i = dayIndexInWeek(h.date); counts[i] = (counts[i] || 0) + 1; });
  const fav = recapFavourite(counts);
  return fav ? { index: +fav.key, label: RECAP_DAY_NAME(+fav.key), count: fav.count } : null;
}

// Moment de la journée favori (séances chronométrées seulement : une séance passée saisie après coup
// n'a pas d'heure) : { slot, label (« le soir »), count } ou null
const RECAP_SLOTS = [
  ['matin', 'le matin', 5, 12], ['midi', 'le midi', 12, 14], ['apres-midi', 'l\'après-midi', 14, 18],
  ['soir', 'le soir', 18, 23],
];
function recapSlotOf(ts) {
  const h = new Date(ts).getHours();
  return (RECAP_SLOTS.find(([, , a, b]) => h >= a && h < b) || ['nuit', 'la nuit'])[0];
}
function recapFavSlot(sessions) {
  const counts = {};
  sessions.filter(h => h.duration > 0).forEach(h => { const s = recapSlotOf(h.date); counts[s] = (counts[s] || 0) + 1; });
  const fav = recapFavourite(counts);
  if (!fav) return null;
  const slot = RECAP_SLOTS.find(s => s[0] === fav.key);
  return { slot: fav.key, label: slot ? slot[1] : 'la nuit', count: fav.count };
}

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
// title : « Jambes d'abord, le soir », « Lève-tôt », « Tout le corps » ; lines : leurs justifications
// (« Jambes · 38 % de tes séries », « Le soir · 2 séances sur 2 ») ; levels : intensité 0..1 par muscle
// (personnage) ; muscles : les 3 plus travaillés { id, label, sets }. null sans muscle ni moment favori.
function recapProfile(history, p, sessions, favSlot, favDay) {
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
      lines.push(['Tout le corps', `${groups.filter(g => g.share >= RECAP_ALL_BODY.share).length} groupes à plus de ${Math.round(RECAP_ALL_BODY.share * 100)} %`]);
    }
  }
  const timed = sessions.filter(h => h.duration > 0);
  if (timed.length >= 2 && timed.every(h => new Date(h.date).getHours() < RECAP_EARLY_HOUR)) {
    parts.push(parts.length ? 'lève-tôt' : 'Lève-tôt');
    lines.push([`Avant ${RECAP_EARLY_HOUR} h`, `${timed.length} séances sur ${timed.length}`]);
  } else if (favSlot) {
    parts.push(parts.length ? favSlot.label : recapCap(favSlot.label));
    lines.push([recapCap(favSlot.label), `${favSlot.count} séances sur ${timed.length}`]);
  }
  if (favDay) lines.push([recapCap(favDay.label), plural(favDay.count, 'séance', 'séances')]);
  if (!parts.length && !muscles.length) return null;
  const title = parts.length ? parts.join(', ') : `${muscles[0].label} en tête`;
  if (!parts.length) lines.unshift([muscles[0].label, plural(muscles[0].sets, 'série', 'séries')]);
  return { title, lines, levels, muscles };
}

// Frise de régularité : semaines (semaine, mois : les 8 dernières jusqu'à la fin de la période ; le mois :
// ses semaines) avec ou sans séance : [{ start, on }] de la plus ancienne à la plus récente
const RECAP_STRIP_WEEKS = 8;
function recapWeekStrip(history, p) {
  const weeks = new Set((history || []).map(h => weekStart(h.date)));
  const last = weekStart(p.end - 1);
  let first = addDays(last, -7 * (RECAP_STRIP_WEEKS - 1));
  if (p.kind === 'month') first = weekStart(p.start);
  const out = [];
  for (let w = first; w <= last; w = addDays(w, 7)) out.push({ start: w, on: weeks.has(w) });
  return out;
}

// Semaines de la période avec au moins une séance (année : « 41 semaines actives »)
function recapActiveWeeks(sessions) { return new Set(sessions.map(h => weekStart(h.date))).size; }

const RECAP_MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
// Paliers de séances franchis pendant la période (10e, 25e, 50e, 100e… séance de tout l'historique), avec
// leur date : [{ n, date }], vide si aucun. Seulement des comptes exacts ; jamais de « nouvel exercice ».
function recapMilestones(history, p) {
  const all = (history || []).filter(h => h && h.date < p.end).sort((a, b) => a.date - b.date);
  const before = all.filter(h => h.date < p.start).length;
  return RECAP_MILESTONES.filter(n => n > before && n <= all.length).map(n => ({ n, date: all[n - 1].date }));
}

// Progression de l'exercice n° 1 sur un mois ou une année : 1RM estimé de sa meilleure série, première
// séance → dernière séance de la période ; seulement s'il monte. { from, to } en kg, sinon null.
function recapExerciseProgress(sessions, top) {
  if (!top) return null;
  const e1s = sessions.map(h => {
    const ex = (h.exercises || []).filter(e => exKey(e) === top.key);
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
  st.profile  = recapProfile(history, p, sessions, st.favSlot, st.favDay);
  st.strip    = recapWeekStrip(history, p);
  st.activeWeeks = recapActiveWeeks(sessions);
  st.milestones = recapMilestones(history, p);
  st.progress = p.kind === 'week' ? null : recapExerciseProgress(sessions, st.topExercise);
  return st;
}

// ── Quand montrer quoi ──────────────────────────────────────

// Semaine que la carte de l'accueil propose : la semaine en cours le dimanche à partir de 18 h, la
// semaine passée le lundi ; null le reste du temps
function recapCardWeek(now = Date.now()) {
  const day = dayIndexInWeek(now);
  if (day === 6 && new Date(now).getHours() >= RECAP_CARD_SUNDAY_HOUR) return recapPeriod('week', now, now);
  if (day === 0) return recapPeriod('week', addDays(now, -7), now);
  return null;
}

// Carte « Ta semaine » à afficher : { period, totals } ou null (réglage coupé, pas le moment, semaine
// sans séance, ou récap déjà vu : seenKey est la clé de la dernière semaine ouverte)
function recapCardInfo({ history = data.history, now = Date.now(), seenKey = null, off = false } = {}) {
  if (off) return null;
  const p = recapCardWeek(now);
  if (!p || seenKey === p.key) return null;
  const totals = recapTotals(recapSessions(history, p));
  return totals.sessions ? { period: p, totals } : null;
}

// Listes de Progrès › Récaps, de la plus récente à la plus ancienne, chacune avec ses totaux :
// semaines terminées (et celle de la carte le dimanche soir), mois terminés, années (les précédentes,
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

// Couleur de chaque écran (css/recap.css, js/features/recap-canvas.js) : une couleur de marque, citron vert
// (chiffres de la période, ouverture, résumé), et trois couleurs attribuées chacune à un type de fait.
//   lime   : séances, volume, résumé (texte noir)
//   violet : profil, muscles, exercice (texte blanc)
//   orange : records, premières fois (texte noir)
//   pink   : régularité (texte noir)
const RECAP_TONES = ['lime', 'violet', 'orange', 'pink'];
const RECAP_SPAN = { week: 'cette semaine', month: 'ce mois', year: 'cette année' };
const RECAP_MINE = { week: 'Ma semaine', month: 'Mon mois', year: 'Mon année' };

// Écrans du récap, dans l'ordre. Chacun : { id, tone, kicker, sub?, title?, value?, unit?, from?, caption?,
// note?, box?, curve?, strip?, bars?, pills?, body?, tiles?, list?, share }. value : le chiffre fort (compté
// à l'arrivée) ; title : un texte fort (profil, nom d'exercice). Rien n'est inventé : un écran sans donnée
// n'est pas produit, une comparaison n'apparaît que si elle est en hausse.
function recapPages(st) {
  if (!st) return [];
  const { period: p, deltas } = st, kind = p.kind;
  const kicker = p.title.toLocaleUpperCase('fr-FR');
  const span = RECAP_SPAN[kind];
  const weeks = kind === 'week' ? st.streak.current : st.streak.longest;
  const pages = [];

  // 1. Ouverture : les séances (hausse seulement ; sinon la régularité, sinon rien)
  const [n, nLbl] = recapCountParts(st.sessions, 'séance', 'séances');
  const up = deltas && deltas.sessions > 0 ? recapDeltaText(kind, 'sessions', deltas.sessions) : '';
  pages.push({ id: 'sessions', tone: 'lime', kicker, sub: p.label, value: n, caption: nLbl,
    note: up || (weeks >= 2 ? (kind === 'week' ? `${weeks} semaines d'affilée` : `Jusqu'à ${weeks} semaines d'affilée`) : ''),
    chips: [st.duration >= 60_000 ? recapNb(fmtDuration(st.duration)) : '', st.records.length ? plural(st.records.length, 'record', 'records') : ''].filter(Boolean),
    body: st.profile && Object.keys(st.profile.levels).length ? st.profile.levels : null, share: 'Partager' });

  // Profil (année : « ton année en un corps »)
  const pr = st.profile;
  const profile = pr && {
    id: 'profile', tone: 'violet', kicker: kind === 'year' ? 'TON ANNÉE EN UN CORPS' : `TON PROFIL ${span.toLocaleUpperCase('fr-FR')}`,
    title: pr.title, lines: pr.lines, body: pr.levels, pills: pr.muscles.map(m => [m.label, String(m.sets)]), share: 'Partager mon profil' };

  // Volume (ou les séries quand rien n'est chargé), séries et durée en tuiles
  const gain = recapVolumeGain(st);
  const volume = st.volume > 0
    ? { id: 'volume', tone: 'lime', kicker, value: recapNb(fmtVolume(st.volume)), caption: `soulevées en ${plural(st.sessions, 'séance', 'séances')}`,
        note: gain ? `+${gain} % par rapport ${RECAP_KINDS[kind].prevTo}` : '',
        tiles: [['Séries', String(st.sets)], ...(st.duration >= 60_000 ? [['Durée', recapNb(fmtDuration(st.duration))]] : [])], share: 'Partager' }
    : { id: 'sets', tone: 'lime', kicker, value: String(st.sets), caption: st.sets > 1 ? 'séries' : 'série',
        note: deltas && deltas.sets > 0 ? recapDeltaText(kind, 'sets', deltas.sets) : '',
        tiles: st.duration >= 60_000 ? [['Durée', recapNb(fmtDuration(st.duration))]] : [], share: 'Partager' };

  // Record le plus marquant, en avant → après, les autres en liste
  let record = null;
  if (st.bestRecord) {
    const r = st.bestRecord, t = recapRecordTexts(r);
    const day = new Date(r.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', ...(kind === 'week' ? {} : { month: 'long' }) });
    record = { id: 'records', tone: 'orange', kicker: `${st.records.length > 1 ? `${st.records.length} RECORDS` : 'NOUVEAU RECORD'} · ${day.toLocaleUpperCase('fr-FR')}`,
      title: r.name, value: t.to, unit: t.unit, from: t.from, caption: t.sub, box: t.gain,
      curve: r.curve ? r.curve.map(x => ({ date: x.date, w: x.w, label: new Date(x.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) })) : null,
      list: st.records.slice(1, RECAP_MAX_RECORDS).map(x => ({ name: x.name, value: recapNb(x.value) })),
      share: 'Partager ce record' };
  }

  // Exercice n° 1 (mois, année : progression du 1RM estimé)
  const ex = st.topExercise && { id: 'exercise', tone: 'violet', kicker: 'TON EXERCICE N° 1', title: st.topExercise.name,
    caption: `${plural(st.topExercise.sessions, 'séance', 'séances')} · ${plural(st.topExercise.sets, 'série', 'séries')}`,
    box: st.progress ? `1RM estimé : ${fmtW(st.progress.from)} → ${fmtW(st.progress.to)} ${unitLbl()}` : '', share: 'Partager' };

  // Régularité : semaines d'affilée et frise ; année : semaines actives et séances par mois
  let streak = null;
  if (kind === 'year') {
    streak = { id: 'streak', tone: 'pink', kicker: 'TA RÉGULARITÉ', value: String(st.activeWeeks), caption: st.activeWeeks > 1 ? 'semaines actives' : 'semaine active',
      note: st.streak.longest >= 2 ? `Plus longue série : ${st.streak.longest} semaines d'affilée` : '',
      bars: st.months ? { values: st.months, top: st.topMonth ? st.topMonth.m : -1 } : null,
      box: st.topMonth ? `${st.topMonth.label}, ton mois le plus actif : ${plural(st.topMonth.count, 'séance', 'séances')}` : '', share: 'Partager' };
  } else if (weeks >= 2) {
    streak = { id: 'streak', tone: 'pink', kicker: 'TA RÉGULARITÉ', value: String(weeks), caption: 'semaines d\'affilée',
      note: kind === 'week' ? 'avec au moins une séance chaque semaine' : 'ta plus longue série ce mois, au moins une séance par semaine',
      strip: st.strip.map(w => ({ on: w.on, label: new Date(w.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) })), share: 'Partager' };
  }

  // Palier de séances : le plus haut en grand, les autres en liste (du plus récent au plus ancien)
  let milestone = null;
  if (st.milestones.length) {
    const date = ts => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const m = st.milestones.at(-1);
    milestone = { id: 'milestone', tone: 'orange', kicker: 'TON PALIER', value: `${m.n}e`, caption: `séance, le ${date(m.date)}`,
      list: st.milestones.slice(0, -1).reverse().slice(0, 4).map(x => ({ name: `${x.n}e séance`, value: date(x.date) })), share: 'Partager' };
  }

  // Petite période (1 ou 2 séances) : le record et la régularité d'abord, le volume ensuite
  const order = st.sessions <= 2 ? [record, streak, profile, volume, ex, milestone] : [profile, volume, record, ex, streak, milestone];
  order.forEach(pg => { if (pg) pages.push(pg); });
  pages.push(recapSummaryPage(st));
  return pages;
}

// Dernier écran : la story elle-même (« Ma semaine »), à partager. Les chiffres en tuiles, le profil en titre.
function recapSummaryPage(st) {
  const { period: p } = st;
  const weeks = p.kind === 'week' ? st.streak.current : st.streak.longest;
  const big = st.volume > 0
    ? { value: recapNb(fmtVolume(st.volume)), caption: `soulevées en ${plural(st.sessions, 'séance', 'séances')}` }
    : { value: String(st.sessions), caption: st.sessions > 1 ? 'séances' : 'séance' };
  const tiles = [];
  tiles.push(['Séries', String(st.sets)]);
  if (st.duration >= 60_000) tiles.push(['Durée', recapNb(fmtDuration(st.duration))]);
  if (st.records.length) tiles.push([st.records.length > 1 ? 'Records' : 'Record', String(st.records.length)]);
  if (st.volume <= 0 && st.duration < 60_000) tiles.unshift(['Séances', String(st.sessions)]);
  if (weeks >= 2) tiles.push(['Semaines d\'affilée', String(weeks)]);
  const lines = [];
  if (st.topExercise) lines.push(['Exercice n° 1', st.topExercise.name]);
  if (p.kind === 'year') {
    if (st.bestRecord) lines.push(['Record le plus marquant', `${st.bestRecord.name} · ${recapNb(st.bestRecord.value)}`]);
    if (st.topMonth) lines.push(['Mois le plus actif', st.topMonth.label]);
  } else if (st.topMuscle) lines.push(['Muscle n° 1', st.topMuscle.label]);
  return { id: 'summary', tone: 'lime', kicker: `${RECAP_MINE[p.kind].toLocaleUpperCase('fr-FR')} · ${p.label.toLocaleUpperCase('fr-FR')}`,
    title: st.profile ? st.profile.title : RECAP_MINE[p.kind], ...big, tiles: tiles.slice(0, 4), lines,
    body: st.profile?.levels || null, share: `Partager ${RECAP_MINE[p.kind].toLowerCase()}` };
}

// Description d'un écran pour VoiceOver et l'aperçu de l'image : la phrase entière, lue d'un trait.
function recapPageAlt(page, st) {
  const head = `${st.period.title}, ${st.period.label}`;
  const sp = s => String(s ?? '').replace(/ /g, ' ');
  const parts = [];
  if (page.title) parts.push(page.title);
  if (page.value) parts.push(page.from ? `${page.from} → ${page.value}${page.unit ? ` ${page.unit}` : ''}` : `${page.value}${page.unit ? ` ${page.unit}` : ''}${page.caption ? ` ${page.caption}` : ''}`);
  if (page.from || (!page.value && page.caption)) parts.push(page.caption);
  if (page.note) parts.push(recapCap(page.note));
  if (page.box) parts.push(page.box);
  if (page.lines) parts.push(page.lines.map(([l, v]) => `${l} : ${v}`).join('. '));
  if (page.pills?.length && page.id === 'profile') parts.push(`Muscles les plus travaillés : ${page.pills.map(([l, v]) => `${l} ${plural(+v, 'série', 'séries')}`).join(', ')}`);
  if (page.tiles?.length) parts.push(page.tiles.map(([l, v]) => `${l} ${v}`).join(', '));
  if (page.curve) parts.push(`Courbe de la meilleure charge : ${page.curve.map(x => `${x.label} ${fmtW(x.w)} ${unitLbl()}`).join(', ')}`);
  if (page.strip) parts.push(`${page.strip.filter(w => w.on).length} semaines actives sur les ${page.strip.length} dernières`);
  if (page.list?.length) parts.push(page.list.map(x => `${x.name} ${x.value}`).join(', '));
  const own = page.kicker === st.period.title.toLocaleUpperCase('fr-FR');
  const kick = page.id === 'summary' ? `${head} en chiffres` : own ? head : `${head}, ${page.kicker.toLocaleLowerCase('fr-FR')}`;
  return sp(`${kick} : ${parts.filter(Boolean).join('. ')}.`);
}

// Nom du fichier partagé : « mdlf-training-recap-w2026-10-19-volume.png »
function recapFileName(p, page) { return `mdlf-training-recap-${p.key}-${page.id}.png`; }
