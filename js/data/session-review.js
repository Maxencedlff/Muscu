// ═══════════════════════════════════════════════════════════
//  Relecture de la séance d'un autre (coach : un élève ; Social : un ami), logique pure
//  Toutes les comparaisons se font avec les SEULES séances de cette personne reçues du serveur
//  (lignes { id, doneAt, s } de coachSessions ou du fil), jamais avec data.history, et jamais avec le
//  poids du corps de la personne qui regarde : currentBodyKg() / entryBodyKg() donneraient le sien. Le poids
//  de la personne relue ne compte que s'il vient avec sa séance (s.bodyKg : un élève qui partage son poids
//  avec son coach, js/data/coach-share.js) ; jamais dans le fil des amis.
//  Affichage : renderCoachSession (js/features/coach-ui.js), renderSocialSession (js/features/social-ui.js).
// ═══════════════════════════════════════════════════════════
'use strict';

// ── Volume ──────────────────────────────────────────────────
// Règle affichée au coach : charge notée × reps (exVolume, js/data/store.js), sans l'échauffement : le serveur
// envoie le marquage warmup depuis la migration 20261031100000_records_series.sql (workSets l'écarte).
// Poids du corps inconnu (bodyKg null) : au poids du corps seul le lest compte, une aide compte 0.
// bodyKg : celui de la personne relue, reçu avec sa séance (partage avec le coach), jamais le nôtre.
function reviewExVolume(ex, bodyKg = null) { return exVolume(ex, ex.sets, bodyKg || null); }
function reviewVolume(exercises, bodyKg = null) { return sessionVolume(exercises || [], bodyKg || null); }
// Poids du corps reçu avec une séance relue, ou null
function reviewBodyKg(s) { return Number.isFinite(s?.bodyKg) && s.bodyKg >= 25 && s.bodyKg <= 300 ? s.bodyKg : null; }

// Écart en % arrondi à l'unité : 'same' de −3 % à +3 % (affiché « = »), sinon 'up' ou 'down' ; null sans référence
const VOLUME_SAME_PCT = 3;
function volumeDelta(cur, prev) {
  if (!(prev > 0) || !(cur >= 0)) return null;
  const raw = (cur - prev) / prev * 100;
  if (Math.abs(raw) <= VOLUME_SAME_PCT) return { dir: 'same', pct: 0 };
  const pct = Math.round(raw);
  return { dir: pct > 0 ? 'up' : 'down', pct };
}
// Durée : écart montré seulement s'il dépasse 20 % (en deçà, c'est la variation normale d'une séance)
const DURATION_GAP_PCT = 20;
function durationDelta(cur, prev) {
  if (!(cur > 0) || !(prev > 0)) return null;
  const pct = Math.round((cur - prev) / prev * 100);
  return Math.abs(pct) > DURATION_GAP_PCT ? pct : null;
}
// « +6 % », « −12 % » (vrai signe moins)
function fmtPct(pct) { return `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`; }

// Ce qui précise une série d'un autre (setKind) : jamais le temps aux 500 m du rameur. Chez soi il vient de
// la durée exacte du chrono (machine.end, js/data/measures.js : setMinutes) ; le serveur n'envoie pas
// `machine`, et 2 km en « 8 min » entiers donneraient 2:00 au lieu de 1:53. Les allures au km suivent les
// minutes saisies, comme pour ses propres séances notées à la main.
function reviewSetKind(ex) {
  const k = setKind(ex);
  return k === 'split' ? null : k;
}

// ── Références : séances d'avant ────────────────────────────

// Séances strictement antérieures à `row` (même instant : départagées par l'id, jamais elle-même), de la plus récente à la plus ancienne
function rowsBefore(row, rows) {
  return (rows || []).filter(r => r && r.id !== row.id && r.doneAt <= row.doneAt && !(r.doneAt === row.doneAt && r.id > row.id))
    .sort((a, b) => b.doneAt - a.doneAt);
}
// Dernière séance du même type (même programme, même séance) : jamais une Push contre une Legs
function prevSameSession(row, rows) {
  const s = row.s;
  return rowsBefore(row, rows).find(r => r.s.category === s.category && entryProg(r.s) === entryProg(s)) || null;
}
// Dernière fois que la personne a fait cet exercice, dans n'importe quelle séance : { ex, doneAt } ou null
function prevExercise(ex, row, rows) {
  for (const r of rowsBefore(row, rows)) {
    const pe = (r.s.exercises || []).find(e => sameEx(e, ex) && doneSets(e).length);
    if (pe) return { ex: pe, doneAt: r.doneAt };
  }
  return null;
}
// Séries de travail faites : reps notées, sans l'échauffement (warmup, envoyé par le serveur)
function doneSets(ex) { return workSets(ex?.sets).filter(s => (parseInt(s.reps) || 0) > 0); }

// ── Flèche d'un exercice ────────────────────────────────────
// Comparaison avec la dernière fois : la charge la plus lourde d'abord (machine d'assistance : la plus
// petite aide), puis, à charge égale, les reps faites à cette charge. Au poids du corps sans lest : le total
// des reps. Renvoie { dir: 'up' | 'same' | 'down', text } ou null (pas de référence, durée, cardio).
function exerciseTrend(ex, prevEx) {
  if (!prevEx || measureOf(ex) !== 'reps') return null;
  const cur = doneSets(ex), prev = doneSets(prevEx);
  if (!cur.length || !prev.length) return null;
  const w = s => parseFloat(s.weight) || 0, r = s => parseInt(s.reps) || 0;
  const repsDiff = d => (d === 0 ? { dir: 'same', text: '=' } : { dir: d > 0 ? 'up' : 'down', text: `${d > 0 ? '+' : '−'}${Math.abs(d)} reps` });
  if (cur.every(s => !w(s)) && prev.every(s => !w(s))) return repsDiff(cur.reduce((a, s) => a + r(s), 0) - prev.reduce((a, s) => a + r(s), 0));
  const aid = loadKind(ex) === 'aide';
  const top = sets => (aid ? Math.min : Math.max)(...sets.map(w));
  const tc = top(cur), tp = top(prev);
  if (tc !== tp) {
    const better = aid ? tc < tp : tc > tp, d = tc - tp;
    return { dir: better ? 'up' : 'down', text: `${aid ? 'aide ' : ''}${d > 0 ? '+' : '−'}${fmtW(Math.abs(d))} ${unitLbl()}` };
  }
  const at = sets => sets.filter(s => w(s) === tc).reduce((a, s) => a + r(s), 0);
  return repsDiff(at(cur) - at(prev));
}

// ── Records ─────────────────────────────────────────────────
// Records notés par son app à l'enregistrement (s.records, js/data/records.js : sessionRecords, avec tout
// son historique), les plus marquants d'abord, au plus `max`. Séance d'une version d'avant (sans records
// notés) : recalculés sur ses seules séances reçues (historyBaseline : même programme, même séance ;
// charge, lest ou reps à charge égale, jamais le 1RM estimé), justes seulement si toutes sont chargées.
// Renvoie [{ ex, kind, before, after, w? , d? }] (format noté).
const LEGACY_KIND = { 'Record charge': 'charge', 'Record lest': 'lest', 'Record reps': 'reps' };
function reviewRecords(row, rows, max = 3) {
  const byRank = list => list.slice().sort((a, b) => NOTED_RANK[b.kind] - NOTED_RANK[a.kind]).slice(0, max);
  if (Array.isArray(row.s.records)) return byRank(row.s.records);
  const entry = r => ({ id: r.id, date: r.doneAt, programme: r.s.programme, category: r.s.category, exercises: r.s.exercises });
  const me = entry(row);
  const base = historyBaseline(me, rowsBefore(row, rows).map(entry));
  const out = [];
  (row.s.exercises || []).forEach(ex => {
    const b = base[recordKey(ex)];
    const rec = b && exerciseRecord(ex, b);
    const kind = rec && LEGACY_KIND[rec.label];
    if (!kind) return;
    const w = parseFloat(rec.s.weight) || 0, r = parseInt(rec.s.reps) || 0;
    out.push(kind === 'reps' ? { ex: ex.name, kind, before: b.prR, after: r, w } : { ex: ex.name, kind, before: b.prW, after: w });
  });
  return byRank(out);
}
// Records de la séance sûrs ? Notés par son app : oui ; recalculés : seulement si toutes ses séances sont là
function reviewRecordsSure(row, complete) { return Array.isArray(row.s.records) || !!complete; }

// ── Notes : mots de douleur ─────────────────────────────────
// Mise en avant seulement (encadré orange), aucun diagnostic. Vocabulaire courant de la douleur et de la
// blessure en salle, sans accents (normName). Volontairement court : pas de parties du corps seules
// (« travail du dos » n'est pas une plainte), pas de « courbatures » (normales après l'effort), et
// « pas mal » (= assez, plutôt bien) écarté ; ni « bloqué » (respiration bloquée) ni « aïe » (« aie » une fois
// sans accent). Un oubli coûte peu : les notes sont de toute façon en haut.
const PAIN_RE = new RegExp('\\b(' + [
  'douleurs?', 'douloureu(x|se|ses)', 'mal', 'genee?s?', 'genante?s?', 'blesse(e|s|es)?', 'blessures?',
  'tendinites?', 'entorses?', 'elongations?', 'dechirures?', 'contractures?', 'crampes?', 'pincements?',
  'tiraillements?', 'craque', 'craquements?', 'coince(e|s|es)?', 'inflamm\\w*', 'lumbago', 'sciatique',
].join('|') + ')\\b');
function painInNotes(text) {
  const t = normName(text).replace(/\bpas mal\b/g, ' ').replace(/['’]/g, ' ');
  return PAIN_RE.test(t);
}

// ── Synthèse d'une séance ───────────────────────────────────
// row : la séance relue ; rows : les autres séances reçues de la même personne (elle-même tolérée).
// Renvoie { volume, bodyKg, prev, volDelta, durGap, exercises: [{ ex, volume, reps, prev, trend }], records }.
// Poids du corps connu (bodyKg) : compté dans le volume. Écart avec la séance d'avant : sous une même règle
// pour les deux (chacune son poids si les deux en ont un, sinon aucune), jamais un mélange qui gonflerait l'écart.
function sessionReview(row, rows) {
  const s = row.s;
  const prev = prevSameSession(row, rows);
  const bodyKg = reviewBodyKg(s);
  const volume = reviewVolume(s.exercises, bodyKg);
  const prevKg = prev ? reviewBodyKg(prev.s) : null;
  const both = bodyKg && prevKg;
  return {
    volume,
    bodyKg,
    prev,
    volDelta: prev ? volumeDelta(both ? volume : reviewVolume(s.exercises), reviewVolume(prev.s.exercises, both ? prevKg : null)) : null,
    durGap: prev ? durationDelta(s.duration, prev.s.duration) : null,
    exercises: s.exercises.map(ex => {
      const p = prevExercise(ex, row, rows);
      return { ex, volume: reviewExVolume(ex, bodyKg), reps: doneSets(ex).reduce((a, x) => a + (parseInt(x.reps) || 0), 0), prev: p, trend: p ? exerciseTrend(ex, p.ex) : null };
    }),
    records: reviewRecords(row, rows, 5),
  };
}
