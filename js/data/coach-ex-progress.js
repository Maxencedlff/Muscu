// ═══════════════════════════════════════════════════════════
//  Courbe de charge par exercice d'un élève, vue par son coach (retours de Sophie, coach, 26/11/2026 : « la fiche
//  montre 7 jours, aucune courbe de charge par exercice sur plusieurs semaines »). Logique pure, sans DOM ni serveur :
//  elle lit les séances que le coach a déjà reçues (coach_student_sessions, js/data/coach.js). Écran :
//  js/features/coach-ex-progress-ui.js ; tests : tests/unit/coach-ex-progress.mjs.
//
//  - Un point par séance : la série de travail la plus lourde de l'exercice (l'échauffement ne compte pas), avec ses reps.
//    Exercices en répétitions seulement, charge notée (> 0) : le poids du corps sans lest n'a pas de courbe de charge.
//  - Fenêtre : les 12 dernières semaines (EXP_WEEKS). Les exercices sont reconnus par leur nom (normName), le nom
//    affiché est celui de la séance la plus récente.
//  - Ordre : les exercices les plus faits d'abord, puis le plus récent.
// ═══════════════════════════════════════════════════════════
'use strict';

const EXP_WEEKS = 12;
const EXP_DAY_MS = 86_400_000;

// rows : [{ doneAt, s: { exercises: [{ name, measure?, sets: [{ weight, reps, warmup? }] }] } }]
// → [{ key, name, points: [{ date, kg, reps }] (du plus ancien au plus récent) }]
function exerciseLoadSeries(rows, now = Date.now(), weeks = EXP_WEEKS) {
  const from = now - weeks * 7 * EXP_DAY_MS;
  const byKey = new Map();
  for (const r of rows || []) {
    const at = Number(r?.doneAt);
    if (!Number.isFinite(at) || at < from || at > now + EXP_DAY_MS) continue;
    for (const e of r.s?.exercises || []) {
      if (!e?.name || measureOf(e) !== 'reps') continue;
      let best = null;
      for (const s of workSets(e.sets)) {
        const kg = parseFloat(s.weight), reps = parseInt(s.reps) || 0;
        if (!(kg > 0) || reps <= 0) continue;
        if (!best || kg > best.kg || (kg === best.kg && reps > best.reps)) best = { kg, reps };
      }
      if (!best) continue;
      const key = normName(e.name);
      const cur = byKey.get(key) || { key, name: e.name, lastAt: -Infinity, byDate: new Map() };
      if (at > cur.lastAt) { cur.lastAt = at; cur.name = e.name; }
      // Le même exercice deux fois dans une séance : la plus lourde des deux
      const prev = cur.byDate.get(at);
      if (!prev || best.kg > prev.kg) cur.byDate.set(at, { date: at, ...best });
      byKey.set(key, cur);
    }
  }
  return [...byKey.values()]
    .map(x => ({ key: x.key, name: x.name, lastAt: x.lastAt, points: [...x.byDate.values()].sort((a, b) => a.date - b.date) }))
    .sort((a, b) => (b.points.length - a.points.length) || (b.lastAt - a.lastAt))
    .map(({ key, name, points }) => ({ key, name, points }));
}

// Écart entre la première et la dernière séance de la fenêtre : { kg, weeks } (kg peut être négatif), null s'il n'y a
// qu'un point
function exerciseLoadChange(series) {
  const p = series?.points || [];
  if (p.length < 2) return null;
  const a = p[0], b = p[p.length - 1];
  return { kg: Math.round((b.kg - a.kg) * 1000) / 1000, weeks: Math.max(1, Math.round((b.date - a.date) / (7 * EXP_DAY_MS))) };
}

// Les séances reçues couvrent-elles la fenêtre ? (toutes reçues, ou la plus ancienne avant son début)
function exerciseLoadCovered(f, now = Date.now(), weeks = EXP_WEEKS) {
  if (!f?.loadedAt) return false;
  if (f.end) return true;
  const oldest = f.rows[f.rows.length - 1]?.doneAt;
  return Number.isFinite(oldest) && oldest <= now - weeks * 7 * EXP_DAY_MS;
}
