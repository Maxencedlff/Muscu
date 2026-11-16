// ═══════════════════════════════════════════════════════════
//  Progrès › Vue d'ensemble : tuiles et séances par semaine
// ═══════════════════════════════════════════════════════════
// Le calendrier du mois est dans l'Historique (js/features/history-calendar.js, retour de Maxence du 16/11) : ici, il
// faisait doublon. Restent ce qui ne relève pas de l'historique : moyennes, total et régularité face à l'objectif.
'use strict';

function renderStatsOverview() {
  const hist = data.history || [];

  // Séances par semaine sur 12 semaines, face à l'objectif des Réglages (weeklyGoal) ; le nombre au-dessus de chaque
  // barre, « 0 » compris (panel t6 : un trait sans valeur passait pour une donnée manquante), une semaine par élément de liste pour VoiceOver (role="img" sur le tout rendait les semaines muettes, panel t5)
  const goal = weeklyGoal();
  const weeks = weeklySessionCounts(12);
  const top = Math.max(goal + 1, ...weeks.map(w => w.n));
  const bars = weeks.map(w => `
      <span class="wk" role="listitem"><span class="visually-hidden">Semaine du ${fmtDate(w.start, 'short')} : ${plural(w.n, 'séance', 'séances')}</span>
        <span class="wk__bar ${w.n >= goal ? 'wk__bar--ok' : ''}" style="height:${w.n / top * 100}%" aria-hidden="true"><span class="wk__n num">${w.n}</span></span>
      </span>`).join('');

  // Tuiles
  const vol  = hist.reduce((a, h) => a + sessionVolume(h.exercises || [], entryBodyKg(h)), 0);
  const durs = hist.filter(h => h.duration > 0).map(h => h.duration);
  const avgD = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;

  return `
    <div class="view stats-overview view--grouped">
      ${navBar({ title: 'Vue d\'ensemble' })}
      <div class="scr">
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${avgD ? fmtDuration(avgD) : '—'}</span><span class="tile__lbl">Durée moyenne</span></div>
          <div class="tile"><span class="tile__val num">${fmtVolume(vol)}</span><span class="tile__lbl">Volume total</span></div>
          <div class="tile"><span class="tile__val num">${hist.length}</span><span class="tile__lbl">${hist.length > 1 ? 'Séances' : 'Séance'} au total</span></div>
        </div>
        <div class="group-title">Séances par semaine</div>
        <div class="group group--pad">
          <div class="wks" role="list" aria-label="Séances par semaine sur 12 semaines, objectif ${goal}">
            <span class="wks__goal" style="bottom:${goal / top * 100}%" aria-hidden="true"><span>${goal}</span></span>
            ${bars}
          </div>
          <div class="wks__axis"><span>il y a 12 sem.</span><span>cette semaine</span></div>
        </div>
      </div>
    </div>`;
}
