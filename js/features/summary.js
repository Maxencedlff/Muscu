// ═══════════════════════════════════════════════════════════
//  Fin de séance : enregistrement et bilan
// ═══════════════════════════════════════════════════════════
'use strict';

let lastSummary = null;  // bilan de la séance qui vient d'être enregistrée

// Meilleure série (la plus lourde, puis le plus de reps). Contrairement à bestSet(), les séries
// sans reps comptent aussi : la tendance du bilan se calcule sur toute la dernière séance.
// ex facultatif : avec une machine d'assistance, moins d'aide est meilleur (w comparé en négatif)
function summaryBestSet(sets, ex = null) {
  const sign = ex && isAssisted(ex) ? -1 : 1;
  return workSets(sets).reduce((b, s) => {   // jamais une série d'échauffement (js/data/warmup.js)
    const w = sign * (parseFloat(s.weight) || 0), r = parseInt(s.reps) || 0;
    if (!b || w > b.w || (w === b.w && r > b.r)) return { w, r, s };
    return b;
  }, null);
}

// Tendance de la meilleure série par rapport à la dernière fois : 'up', 'same', 'down' (null sans précédent)
function bestSetTrend(b, pb) {
  if (!pb) return null;
  if (b.w > pb.w || (b.w === pb.w && b.r > pb.r)) return 'up';
  return b.w === pb.w && b.r === pb.r ? 'same' : 'down';
}

function buildSummary(entry) {
  const prevH = data.history.find(h => h !== entry && h.category === entry.category && entryProg(h) === entryProg(entry));
  let cur = 0, prev = 0;
  const rows = [], e1rm = [];
  // Records notés dans la séance à l'enregistrement (sessionRecords, js/data/records.js)
  const noted = entryRecords(entry);
  const priorOf = sessionPriorOf(entry, data.history);   // séries d'avant la séance, pour le 1RM estimé
  entry.exercises.forEach(ex => {
    const pex = prevH?.exercises.find(e => sameEx(e, ex));
    cur  += exVolume(ex, ex.sets, entryBodyKg(entry));
    // Même nombre de séries de travail des deux côtés (échauffements retirés avant de couper : sinon
    // l'échauffement d'aujourd'hui ferait entrer une série de travail de plus de la dernière fois, ou
    // celui de la dernière fois en ferait sortir une)
    prev += pex ? exVolume(pex, workSets(pex.sets).slice(0, workSets(ex.sets).length), entryBodyKg(prevH)) : 0;
    // 1RM estimé battu sans autre record : pour soi seulement (jamais noté dans la séance ni partagé)
    const e1s = !noted.some(r => normName(r.ex) === normName(ex.name)) && e1rmRecordSet(ex, priorOf(ex));
    if (e1s) e1rm.push({ name: ex.name, label: 'Record 1RM est.', weight: e1s.weight, reps: e1s.reps, measure: 'reps', kind: setKind(ex) });
    const b = summaryBestSet(ex.sets, ex), pb = summaryBestSet(pex?.sets, ex);
    // Exercice réduit à son échauffement (séries de travail non faites) : la série la plus lourde quand même
    const bs = b || summaryBestSet(ex.sets.map(s => ({ ...s, warmup: undefined })), ex);
    const trend = b ? bestSetTrend(b, pb) : null;
    // Progrès de la meilleure série (ligne sous le titre) : charge gagnée, sinon reps gagnées ; durée, cardio et aide à part
    const gain = trend === 'up' && measureOf(ex) === 'reps' && !isAssisted(ex) ? (b.w > pb.w ? { w: b.w - pb.w } : { r: b.r - pb.r }) : null;
    rows.push({ name: ex.name, weight: bs.s.weight, reps: bs.s.reps, dist: bs.s.dist, measure: measureOf(ex), kind: setKind(ex), trend, gain });
  });
  const records = [...noted.map(r => ({ name: r.ex, label: notedLabel(r), txt: notedValueTxt(r) })), ...e1rm];
  return {
    id: entry.id, programme: entry.programme, category: entry.category, date: entry.date,
    duration: entry.duration, sets: entry.exercises.reduce((a, e) => a + workSets(e.sets).length, 0),   // séries de travail
    volume: cur, delta: prevH ? cur - prev : null, records, rows,
    recordCount: noted.length,   // « N records battus » : la règle de l'historique et de Progrès (recordCount), sans le 1RM estimé
    // Sans charge comptée (poids du corps inconnu, gainage…) : le total de reps remplace « 0 kg »
    reps: entry.exercises.filter(ex => measureOf(ex) === 'reps').reduce((a, ex) => a + volumeSets(ex.sets).reduce((b, s) => b + (parseInt(s.reps) || 0), 0), 0),   // sous-séries comprises
    needsBodyKg: !entryBodyKg(entry) && entry.exercises.some(ex => bodyShare(ex) > 0),
  };
}

// Ligne sous le titre du bilan : ce qui a progressé (« 1 record battu · +1 rep sur développé couché »), la
// plus forte hausse de charge d'abord, sinon de reps ; rien de battu : la régularité (« Séance faite · 3 cette semaine »).
// weekCount : séances de la semaine, celle-ci comprise (weekStats, js/features/dashboard.js)
function summaryLine(sm, weekCount = weekStats(sm.date).count) {
  const parts = [];
  const n = sm.recordCount ?? 0;
  if (n) parts.push(plural(n, 'record battu', 'records battus'));
  const top = sm.rows.filter(r => r.gain).sort((a, b) => (b.gain.w || 0) - (a.gain.w || 0) || (b.gain.r || 0) - (a.gain.r || 0))[0];
  if (top) {
    // Nom en minuscule dans la phrase, sauf un sigle (« RDL »)
    const name = /^.\p{Ll}/u.test(top.name) ? top.name.charAt(0).toLowerCase() + top.name.slice(1) : top.name;
    parts.push(`+${top.gain.w ? `${fmtW(top.gain.w)} ${unitLbl()}` : plural(top.gain.r, 'rep', 'reps')} sur ${name}`);
  }
  if (parts.length) return parts.join(' · ');
  return `Séance faite · ${weekCount > 1 ? `${weekCount} cette semaine` : 'la 1re cette semaine'}`;
}

const TREND_HTML = {
  up:   '<span class="sum-trend sum-trend--up" aria-label="en progrès">↑</span>',
  down: '<span class="sum-trend sum-trend--down" aria-label="en baisse">↓</span>',
  same: '<span class="sum-trend" aria-label="identique">=</span>',
};
const NO_TREND_HTML = '<span class="sum-trend" aria-hidden="true"></span>';

// « 32,5 kg × 10 » (reps seules au poids du corps)
function summarySetTxt(r) {
  if ((r.measure && r.measure !== 'reps') || (r.kind && r.kind !== 'charge')) return esc(measureSetTxt(r, r.measure || 'reps', r.kind));
  return hasLoad(r.weight) ? `${loadTimes(r.weight)}${esc(r.reps)}` : `${esc(r.reps)} reps`;
}

// Volume : écart avec la dernière séance du même type, rien s'il n'y en a pas ou s'il est nul
// Valeur d'une tuile du bilan : le nombre en grand, l'unité (« min », « h », « t », « kg ») en petit, pour
// que « 52 min » ou « 12,5 t » tiennent dans un tiers d'iPhone SE (panel du 07/11 : « 52 min » débordait)
function sumTileValueHtml(txt) {
  return esc(txt).replace(/[A-Za-z]+(?: [A-Za-z]+)?/g, u => `<span class="sum-tile__unit">${u}</span>`);
}

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
              <div class="sum-row__val num">${r.txt != null ? esc(r.txt) : summarySetTxt(r)}</div>
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

// Exercices de la séance dont l'app ne connaît pas les muscles : choisis ici plutôt qu'en pleine série
function summaryUnknownMusclesHtml(h) {
  const index = chosenMusclesIndex();
  const names = [...new Map((h?.exercises || []).filter(e => !exerciseMuscles(e, index).primary.length)
    .map(e => [normName(e.name), e.name])).values()];
  if (!names.length) return '';
  return `
        <div class="sum-section-title">Muscles à choisir</div>
        <div class="sum-list">
          ${names.map(n => `
            <button class="sum-row sum-row--action" data-action="declare-muscles" data-name="${esc(n)}">
              <div class="sum-row__main"><div class="sum-row__name">${esc(n)}</div><div class="sum-row__sub">Pour la récupération et Progrès</div></div>
              <span class="sum-row__cta">Choisir</span>
            </button>`).join('')}
        </div>`;
}

function renderSummary() {
  const sm = lastSummary;
  if (!sm) return renderDashboard();
  const meta = sessionMeta(sm.category, sm.programme);
  const h    = data.history.find(x => x.id === sm.id);
  const date = fmtDate(sm.date, 'day') + ' · ' + fmtTime(sm.date);
  // Médailles animées au premier affichage seulement (le bilan se redessine : poids du corps, muscles…)
  const pop = !sm.shown;
  sm.shown = true;
  return `
    <div class="view summary${pop ? ' summary--pop' : ''}" style="--cat-color:${meta.color}">
      <div class="summary-content">
        <div class="sum-head">
          <h1 class="sum-title">${esc(meta.label)}</h1>
          <div class="sum-date">${esc(date)}</div>
          <p class="sum-line">${sm.recordCount ? medalSvg(18) : ''}<span>${esc(summaryLine(sm))}</span></p>
        </div>
        <div class="sum-tiles">
          <div class="sum-tile"><div class="sum-tile__label">Durée</div><div class="sum-tile__value num">${sumTileValueHtml(fmtDuration(sm.duration))}</div></div>
          ${sm.volume > 0 || !sm.reps
            ? `<div class="sum-tile"><div class="sum-tile__label">Volume</div><div class="sum-tile__value num">${sumTileValueHtml(fmtVolume(sm.volume))}</div>${summaryDeltaHtml(sm.delta)}</div>`
            : `<div class="sum-tile"><div class="sum-tile__label">Reps</div><div class="sum-tile__value num">${sm.reps}</div></div>`}
          <div class="sum-tile"><div class="sum-tile__label">Séries</div><div class="sum-tile__value num">${sm.sets}</div></div>
        </div>
        ${sm.needsBodyKg ? `<button class="sum-hint" data-action="set-body-weight">Ajoute ton poids pour compter le volume des exercices au poids du corps ${icon('chevron.right', 14)}</button>` : ''}
        ${shareStoryButton(sm.id, 'sum-share')}
        ${summaryRecordsHtml(sm.records)}
        ${summaryStrengthHtml(h)}
        <div class="sum-section-title">Exercices</div>
        <div class="sum-list">
          ${summaryRowsHtml(sm.rows)}
        </div>
        ${summaryUnknownMusclesHtml(h)}
        <div class="sum-section-title">Notes</div>
        <textarea id="summaryNotes" class="sum-notes" rows="3" placeholder="Comment s'est passée la séance ?"
                  aria-label="Notes de séance">${esc(h?.notes || '')}</textarea>
        ${coachNotesHint()}
        ${summarySocialGroup(h)}
        ${stravaSummaryGroup(h)}
        <div class="sum-done-bar"><button class="sum-done" data-action="summary-done">Terminé</button></div>
      </div>
    </div>`;
}

// Poids du corps saisi depuis le bilan : la séance le reçoit et le bilan est recalculé (volume, indication)
function refreshSummaryBodyKg() {
  const h = lastSummary && data.history.find(x => x.id === lastSummary.id);
  if (!h || h.bodyKg || !currentBodyKg()) return;
  if (storableBodyKg()) h.bodyKg = storableBodyKg();   // pesée de Santé : relue, jamais gardée
  lastSummary = buildSummary(h);
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
  const entry = {
    id:         uid(),
    programme:  sp,
    category:   sc,
    date:       Date.now(),
    duration:   Date.now() - activeSession.startedAt,
    notes:      sessionNotes.trim(),
    ...(storableBodyKg() ? { bodyKg: storableBodyKg() } : {}),
    ...(newSessionHidden() ? { hidden: true } : {}),   // Réglages › Amis et coach › Séances visibles par défaut éteint
    exercises:  activeSession.exercises
      .map(ex => ({
        exId: ex.exId || resolveExId(sp, sc, ex.name),
        name: ex.name,
        ...(storedMeasure(ex) ? { measure: storedMeasure(ex) } : {}),
        ...(ex.tempo ? { tempo: ex.tempo } : {}),   // fait au tempo : plus dur, à ne pas comparer sans le savoir
        ...(ssId(ex) ? { ss: ex.ss } : {}),         // superset, affiché comme tel dans Historique et pour les abonnés
        ...(cleanGrip(ex.grip, ex) ? { grip: cleanGrip(ex.grip, ex) } : {}),   // prise (js/data/grips.js), même exercice pour les records
        // warmup (js/data/warmup.js) et rir (js/data/rir.js) : champs facultatifs, ignorés par une version précédente
        sets: ex.sets.filter(s => s.done).map(s => ({ weight: s.weight, reps: s.reps, ...(s.dist ? { dist: s.dist } : {}), ...(s.machine ? { machine: s.machine } : {}),
          ...(isWarmupSet(s) ? { warmup: true } : {}), ...(cleanRir(s.rir) !== null ? { rir: cleanRir(s.rir) } : {}),
          ...techFields(s, { doneOnly: true }) })),   // technique et sous-séries validées (js/data/intensif.js)
      }))
      .filter(ex => ex.sets.length),
  };
  ssNormalize(entry.exercises);   // exercice vide écarté : un groupe réduit à un seul n'en est plus un
  return entry;
}

// Enregistre la séance ; stockage plein : rien n'est perdu, la séance reste active et on propose
// d'exporter (séance comprise) avant de tout remettre comme avant. Renvoie l'entrée, ou null.
async function saveSessionEntry() {
  const sp = activeSession.programme, sc = activeSession.category;
  if (!data.programmes[sp]) data.programmes[sp] = { exercises: {}, timers: {}, cooldowns: {} };
  const timers    = data.programmes[sp].timers;
  const prevTimer = timers[sc] ?? null;
  const entry     = sessionHistoryEntry(sp, sc);
  // Records battus, notés dans la séance (partagés avec elle : amis, coach) ; tableau vide sans record
  entry.records   = sessionRecords(entry, data.history);
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
    if (editingSet && !saveEditedSet()) return;   // correction en cours d'une série validée : enregistrée d'abord
    closeSessSheets();
    const { total, done } = sessionSetCounts();
    const choice = await askFinishSession(done, total);
    if (choice === 'discard') {
      if (done && !(await confirmSheet('Abandonner la séance ?', `Les ${done} séries validées seront perdues.`, 'Abandonner'))) return;
      leaveSession('Séance abandonnée');
      return;
    }
    if (choice !== 'save') return;
    // Mode lecture seule (verrou allumé, plus le droit d'écrire) : l'abonnement est proposé et la
    // séance en cours reste en cours, avec toutes ses séries. Rien n'est supprimé.
    // Séance COMMENCÉE avec le droit d'écrire (writeOk) : elle s'enregistre même si l'accès a pris fin
    // pendant la séance ; le serveur l'accepte dans sa grâce bornée (24 h après la fin de l'accès,
    // 2 séances au plus), et s'il la refuse quand même, elle reste sur l'iPhone sans rien perdre.
    if (!activeSession.writeOk && !(await accessGate())) return;

    // La séance a pu disparaître entre-temps (séance perso supprimée, import) : elle est
    // enregistrée quand même : l'historique sait afficher une catégorie inconnue (sessionMeta)
    const entry = await saveSessionEntry();
    if (!entry) return;
    syncWorkoutToHealth(entry);   // app iOS : entraînement dans Santé, sans attendre
    // Bilan : records notés à l'enregistrement (et 1RM estimé battu, pour soi)
    lastSummary = buildSummary(entry);
    if (lastSummary.records.length) recordSound(); else finishSound();
    haptic(lastSummary.recordCount ? 'success' : 'light');   // record : avec la médaille qui apparaît (css/session.css)
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
