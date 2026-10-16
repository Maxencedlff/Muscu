// ═══════════════════════════════════════════════════════════
//  Fin de séance : enregistrement et bilan
// ═══════════════════════════════════════════════════════════
'use strict';

let lastSummary = null;  // bilan de la séance qui vient d'être enregistrée

const RECORD_RANK = { 'Record charge': 3, 'Record reps': 2, 'Record 1RM est.': 1 };

// Meilleure série (la plus lourde, puis le plus de reps). Contrairement à bestSet(), les séries
// sans reps comptent aussi : la tendance du bilan se calcule sur toute la dernière séance.
function summaryBestSet(sets) {
  return (sets || []).reduce((b, s) => {
    const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
    if (!b || w > b.w || (w === b.w && r > b.r)) return { w, r, s };
    return b;
  }, null);
}

// Record le plus marquant d'un exercice : charge > reps > 1RM estimé, puis la série la plus lourde
function exerciseRecord(ex, base) {
  const score = s => (parseFloat(s.weight) || 0) * 100 + (+s.reps);
  let rec = null;
  ex.sets.forEach(s => {
    const l = recordLabel(s, base);
    if (!l) return;
    const rank = RECORD_RANK[l], best = rec && RECORD_RANK[rec.label];
    if (!rec || rank > best || (rank === best && score(s) > score(rec.s))) rec = { label: l, s };
  });
  return rec;
}

// Tendance de la meilleure série par rapport à la dernière fois : 'up', 'same', 'down' (null sans précédent)
function bestSetTrend(b, pb) {
  if (!pb) return null;
  if (b.w > pb.w || (b.w === pb.w && b.r > pb.r)) return 'up';
  return b.w === pb.w && b.r === pb.r ? 'same' : 'down';
}

function buildSummary(entry, baseline) {
  const prevH = data.history.find(h => h !== entry && h.category === entry.category && (h.programme || 'ppl') === entry.programme);
  let cur = 0, prev = 0;
  const records = [], rows = [];
  entry.exercises.forEach(ex => {
    const pex = prevH?.exercises.find(e => sameEx(e, ex));
    cur  += setsVolume(ex.sets);
    prev += setsVolume(pex?.sets.slice(0, ex.sets.length) || []);
    const rec = exerciseRecord(ex, baseline[ex.exId]);
    if (rec) records.push({ name: ex.name, label: rec.label, weight: rec.s.weight, reps: rec.s.reps });
    const b = summaryBestSet(ex.sets), pb = summaryBestSet(pex?.sets);
    rows.push({ name: ex.name, weight: b.s.weight, reps: b.s.reps, trend: bestSetTrend(b, pb) });
  });
  return {
    id: entry.id, programme: entry.programme, category: entry.category, date: entry.date,
    duration: entry.duration, sets: entry.exercises.reduce((a, e) => a + e.sets.length, 0),
    volume: cur, delta: prevH ? cur - prev : null, records, rows,
  };
}

const TREND_HTML = {
  up:   '<span class="sum-trend sum-trend--up" aria-label="en progrès">↑</span>',
  down: '<span class="sum-trend sum-trend--down" aria-label="en baisse">↓</span>',
  same: '<span class="sum-trend" aria-label="identique">=</span>',
};
const NO_TREND_HTML = '<span class="sum-trend" aria-hidden="true"></span>';

// « 32,5 kg × 10 » (reps seules au poids du corps)
function summarySetTxt(r) { return `${loadTimes(r.weight)}${esc(r.reps)}`; }

// Volume : écart avec la dernière séance du même type, rien s'il n'y en a pas ou s'il est nul
function summaryDeltaHtml(delta) {
  if (delta === null || Math.round(delta) === 0) return '';
  return `<span class="sum-tile__delta ${delta > 0 ? 'sum-tile__delta--up' : ''}">${delta > 0 ? '↑ ' : '↓ '}${fmtVolume(Math.abs(delta))}</span>`;
}

function summaryRecordsHtml(records) {
  if (!records.length) return '';
  return `
        <div class="sum-section-title">Nouveaux records</div>
        <div class="sum-list sum-records">
          ${records.map(r => `
            <div class="sum-row sum-record">
              ${medalSvg(24)}
              <div class="sum-row__main"><div class="sum-row__name">${esc(r.name)}</div><div class="sum-row__sub">${r.label}</div></div>
              <div class="sum-row__val num">${summarySetTxt(r)}</div>
            </div>`).join('')}
        </div>`;
}

function summaryRowsHtml(rows) {
  return rows.map(r => `
            <div class="sum-row">
              <div class="sum-row__main"><div class="sum-row__name">${esc(r.name)}</div><div class="sum-row__sub">Meilleure série</div></div>
              <div class="sum-row__val num">${summarySetTxt(r)}</div>
              ${TREND_HTML[r.trend] || NO_TREND_HTML}
            </div>`).join('');
}

function renderSummary() {
  const sm = lastSummary;
  if (!sm) return renderDashboard();
  const meta = sessionMeta(sm.category, sm.programme);
  const h    = data.history.find(x => x.id === sm.id);
  const date = fmtDate(sm.date, 'day') + ' · ' + fmtTime(sm.date);
  return `
    <div class="view summary" style="--cat-color:${meta.color}">
      <div class="summary-content">
        <div class="sum-head">
          <h1 class="sum-title">${esc(meta.label)}</h1>
          <div class="sum-date">${esc(date)}</div>
        </div>
        <div class="sum-tiles">
          <div class="sum-tile"><div class="sum-tile__label">Durée</div><div class="sum-tile__value num">${fmtDuration(sm.duration)}</div></div>
          <div class="sum-tile"><div class="sum-tile__label">Volume</div><div class="sum-tile__value num">${fmtVolume(sm.volume)}</div>${summaryDeltaHtml(sm.delta)}</div>
          <div class="sum-tile"><div class="sum-tile__label">Séries</div><div class="sum-tile__value num">${sm.sets}</div></div>
        </div>
        ${summaryRecordsHtml(sm.records)}
        <div class="sum-section-title">Exercices</div>
        <div class="sum-list">
          ${summaryRowsHtml(sm.rows)}
        </div>
        <div class="sum-section-title">Notes</div>
        <textarea id="summaryNotes" class="sum-notes" rows="3" placeholder="Comment s'est passée la séance ?"
                  aria-label="Notes de séance">${esc(h?.notes || '')}</textarea>
        <button class="sum-done" data-action="summary-done">Terminé</button>
      </div>
    </div>`;
}

// Notes du bilan : enregistrées au fil de la frappe
let summaryNotesTimer = null;
function summaryNotesInput(value) {
  const h = lastSummary && data.history.find(x => x.id === lastSummary.id);
  if (!h) return;
  h.notes = value.trim();
  clearTimeout(summaryNotesTimer);
  summaryNotesTimer = setTimeout(() => save(), 300);
}

// ── Terminer la séance ──────────────────────────────────────

// Feuille « Terminer la séance ? » : 'save', 'discard' ou rien (continuer)
function askFinishSession(done, total) {
  const dur = fmtDuration(Date.now() - activeSession.startedAt);
  return dialog({ type: 'sheet',
    title: done ? 'Terminer la séance ?' : 'Aucune série validée',
    message: done ? `${done} / ${total} séries · ${dur}` : 'Valide au moins une série pour enregistrer la séance.',
    actions: [
      ...(done ? [{ label: 'Enregistrer la séance', value: 'save', style: 'preferred' }] : []),
      { label: 'Abandonner la séance', value: 'discard', style: 'destructive' },
      { label: done ? 'Continuer' : 'Continuer la séance', style: 'cancel' },
    ] });
}

// Séance close sans bilan : retour à l'accueil avec un message
function leaveSession(message) {
  endSession();
  routeTo('dashboard'); startTicker();
  showToast(message);
}

// Entrée d'historique : seules les séries validées, exercices vides écartés
function sessionHistoryEntry(sp, sc) {
  return {
    id:         uid(),
    programme:  sp,
    category:   sc,
    date:       Date.now(),
    duration:   Date.now() - activeSession.startedAt,
    notes:      sessionNotes.trim(),
    exercises:  activeSession.exercises
      .map(ex => ({
        exId: ex.exId || resolveExId(sp, sc, ex.name),
        name: ex.name,
        sets: ex.sets.filter(s => s.done).map(s => ({ weight: s.weight, reps: s.reps })),
      }))
      .filter(ex => ex.sets.length),
  };
}

// Enregistre la séance ; stockage plein : rien n'est perdu, la séance reste active et on propose
// d'exporter (séance comprise) avant de tout remettre comme avant. Renvoie l'entrée, ou null.
async function saveSessionEntry() {
  const sp = activeSession.programme, sc = activeSession.category;
  if (!data.programmes[sp]) data.programmes[sp] = { exercises: {}, timers: {}, cooldowns: {} };
  const timers    = data.programmes[sp].timers;
  const prevTimer = timers[sc] ?? null;
  const entry     = sessionHistoryEntry(sp, sc);
  timers[sc] = entry.date;
  data.history.unshift(entry);
  recomputePRFromHistory();
  if (save(true)) return entry;

  const act = await dialog({ title: 'Espace de stockage plein',
    message: 'Exporte tes données pour ne pas perdre cette séance.',
    actions: [
      { label: 'Plus tard', style: 'cancel' },
      { label: 'Exporter', value: 'export', style: 'preferred' },
    ] });
  if (act === 'export') await exportData(themePref());
  data.history = data.history.filter(h => h !== entry);
  timers[sc] = prevTimer;
  recomputePRFromHistory();
  return null;
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'finish-session': async () => {
    closeSessSheets();
    const { total, done } = sessionSetCounts();
    const choice = await askFinishSession(done, total);
    if (choice === 'discard') {
      if (done && !(await confirmSheet('Abandonner la séance ?', `Les ${done} séries validées seront perdues.`, 'Abandonner'))) return;
      leaveSession('Séance abandonnée');
      return;
    }
    if (choice !== 'save') return;

    // La séance a pu disparaître entre-temps (séance perso supprimée, import) : elle est
    // enregistrée quand même : l'historique sait afficher une catégorie inconnue (sessionMeta)
    const entry = await saveSessionEntry();
    if (!entry) return;
    syncWorkoutToHealth(entry);   // app iOS : entraînement dans Santé, sans attendre
    // Bilan : records comparés à ceux d'avant la séance
    lastSummary = buildSummary(entry, activeSession.baseline || {});
    if (lastSummary.records.length) recordSound(); else finishSound();
    haptic();
    endSession();
    openSummary(); window.scrollTo(0, 0);
    // Le bilan montre déjà que la séance est enregistrée : pas de toast sur son titre, annonce VoiceOver.
    // Ferme le toast « Série validée · Annuler » de la dernière série, devenu sans objet.
    document.querySelectorAll('.toast').forEach(t => t.remove());
    announce('Séance enregistrée');
  },
  'summary-done': () => {
    const ta = $('#summaryNotes');
    if (ta) summaryNotesInput(ta.value);
    clearTimeout(summaryNotesTimer);
    save();
    lastSummary = null;
    routeTo('dashboard'); startTicker();
  },
});
