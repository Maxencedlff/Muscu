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

// Records battus pendant la période, un par exercice (le plus marquant : charge > reps > 1RM, puis le
// plus lourd), comparés aux séances d'avant chacune (historyBaseline : même programme, même séance),
// exactement comme le bilan et l'image d'une séance. Du plus marquant au moins marquant.
function recapRecords(sessions, history) {
  const best = new Map();
  sessions.forEach(h => {
    const base = historyBaseline(h, history);
    (h.exercises || []).forEach(ex => {
      const rec = exerciseRecord(ex, base[recordKey(ex)]);
      if (!rec) return;
      const b = bestSet([rec.s], ex);
      if (!b) return;
      const item = { key: recordKey(ex), name: ex.name, label: rec.label, value: setTxt(b, ex), w: b.w, r: b.r, rank: RECORD_RANK[rec.label] || 0, date: h.date };
      const prev = best.get(item.key);
      if (!prev || recapRecordRank(item) > recapRecordRank(prev)) best.set(item.key, item);
    });
  });
  return [...best.values()].sort((a, b) => recapRecordRank(b) - recapRecordRank(a) || b.date - a.date);
}
function recapRecordRank(r) { return r.rank * 1e9 + r.w * 1e3 + r.r; }

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
      const it = by.get(k) || { name: e.name, sessions: 0, sets: 0 };
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

// Écrans du récap, dans l'ordre : chacun un chiffre fort. { id, kicker, value, caption, note, text?, list?, tiles?, lines? }
// text : la valeur est un nom (exercice, muscle, jour), pas un nombre. Rien n'est inventé : un écran
// sans donnée n'est pas produit.
function recapPages(st) {
  if (!st) return [];
  const { period: p, deltas } = st, kind = p.kind;
  const kicker = p.title.toLocaleUpperCase('fr-FR');
  const delta = field => deltas ? recapDeltaText(kind, field, deltas[field]) : '';
  const pages = [];
  const [n, nLbl] = recapCountParts(st.sessions, 'séance', 'séances');
  pages.push({ id: 'sessions', kicker, value: n, caption: nLbl, note: delta('sessions'), sub: p.label });
  if (st.duration >= 60_000) pages.push({ id: 'duration', kicker, value: fmtDuration(st.duration), caption: 'd\'entraînement', note: delta('duration') });
  if (st.volume > 0) pages.push({ id: 'volume', kicker, value: fmtVolume(st.volume), caption: 'de charge soulevée', note: delta('volume') });
  pages.push({ id: 'sets', kicker, value: String(st.sets), caption: st.sets > 1 ? 'séries' : 'série', note: delta('sets') });
  if (st.records.length) {
    const [r, rLbl] = recapCountParts(st.records.length, 'record battu', 'records battus');
    pages.push({ id: 'records', kicker, value: r, caption: rLbl, note: '', list: st.records.slice(0, RECAP_MAX_RECORDS).map(x => ({ name: x.name, value: x.value })) });
  }
  if (st.topExercise) pages.push({ id: 'exercise', kicker, text: true, value: st.topExercise.name, caption: 'ton exercice n° 1', note: `${plural(st.topExercise.sessions, 'séance', 'séances')} · ${plural(st.topExercise.sets, 'série', 'séries')}` });
  if (st.topMuscle) pages.push({ id: 'muscle', kicker, text: true, value: st.topMuscle.label, caption: 'ton muscle le plus travaillé', note: plural(st.topMuscle.sets, 'série', 'séries') });
  if (st.favDay) {
    pages.push({ id: 'when', kicker, text: true, value: recapCap(st.favDay.label), caption: 'ton jour d\'entraînement',
      note: [plural(st.favDay.count, 'séance', 'séances'), st.favSlot ? `surtout ${st.favSlot.label}` : ''].filter(Boolean).join(' · ') });
  } else if (st.favSlot) {
    pages.push({ id: 'when', kicker, text: true, value: recapCap(st.favSlot.label), caption: 'ton moment d\'entraînement', note: `${st.favSlot.count} séances sur ${st.sessions}` });
  }
  const weeks = kind === 'week' ? st.streak.current : st.streak.longest;
  if (weeks >= 2) pages.push({ id: 'streak', kicker, value: String(weeks), caption: 'semaines d\'affilée', note: kind === 'week' ? 'avec au moins une séance' : 'ta plus longue série, au moins une séance par semaine' });
  if (kind === 'year' && st.topMonth) pages.push({ id: 'month', kicker, text: true, value: st.topMonth.label, caption: 'ton mois le plus actif', note: plural(st.topMonth.count, 'séance', 'séances') });
  pages.push(recapSummaryPage(st));
  return pages;
}

// Dernier écran : tout en un (c'est lui qu'on partage le plus). Année : « ton année en chiffres ».
function recapSummaryPage(st) {
  const { period: p } = st;
  const tiles = [['Séances', String(st.sessions)]];
  if (st.duration >= 60_000) tiles.push(['Durée', fmtDuration(st.duration)]);
  if (st.volume > 0) tiles.push(['Volume', fmtVolume(st.volume)]);
  tiles.push(['Séries', String(st.sets)]);
  const lines = [];
  if (st.topExercise) lines.push(['Exercice n° 1', st.topExercise.name]);
  if (p.kind === 'year') {
    if (st.bestRecord) lines.push(['Record le plus marquant', `${st.bestRecord.name} · ${st.bestRecord.value}`]);
    if (st.topMonth) lines.push(['Mois le plus actif', st.topMonth.label]);
  } else {
    if (st.topMuscle) lines.push(['Muscle n° 1', st.topMuscle.label]);
    if (st.records.length) lines.push(['Records battus', String(st.records.length)]);
  }
  return { id: 'summary', kicker: p.kind === 'year' ? 'TON ANNÉE EN CHIFFRES' : 'EN CHIFFRES', text: true, value: p.label, caption: '', note: '', tiles, lines };
}

// Description d'un écran pour VoiceOver et l'aperçu de l'image : « Ta semaine, 19 – 25 octobre : 4 séances. +1 séance par rapport à la semaine d'avant. »
function recapPageAlt(page, st) {
  const head = `${st.period.title}, ${st.period.label}`;
  if (page.id === 'summary') {
    return `${head} en chiffres : ${page.tiles.map(([l, v]) => `${l} ${v}`).join(', ')}.${page.lines.length ? ` ${page.lines.map(([l, v]) => `${l} : ${v}`).join('. ')}.` : ''}`;
  }
  const list = page.list ? ` ${page.list.map(x => `${x.name} ${x.value}`).join(', ')}.` : '';
  return `${head} : ${page.value} ${page.caption}.${page.note ? ` ${recapCap(page.note)}.` : ''}${list}`;
}

// Nom du fichier partagé : « mdlf-training-recap-w2026-10-19-volume.png »
function recapFileName(p, page) { return `mdlf-training-recap-${p.key}-${page.id}.png`; }
