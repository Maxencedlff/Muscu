// ═══════════════════════════════════════════════════════════
//  Progrès › Vue d'ensemble : calendrier et séances par semaine
// ═══════════════════════════════════════════════════════════
'use strict';

function renderStatsOverview() {
  const now  = new Date();
  if (!ovMonth) ovMonth = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = ovMonth;
  const hist = data.history || [];

  // Calendrier du mois : lundi en premier
  const first = new Date(y, m, 1);
  const days  = new Date(y, m + 1, 0).getDate();
  const lead  = (first.getDay() + 6) % 7;
  const byDay = {};
  hist.forEach(h => {
    const d = new Date(h.date);
    if (d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] ||= []).push(h);
  });
  const today = (now.getFullYear() === y && now.getMonth() === m) ? now.getDate() : 0;
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal__d cal__d--empty"></span>';
  for (let d = 1; d <= days; d++) {
    const hs = byDay[d] || [];
    const lbl = hs.length ? `, ${hs.map(h => sessionMeta(h.category, h.programme || 'ppl').label).join(', ')}` : '';
    cells += `<span class="cal__d ${d === today ? 'cal__d--today' : ''}" aria-label="${d}${lbl}"><span class="num">${d}</span>
      <span class="cal__dots">${hs.slice(0, 3).map(h => `<i style="background:${historyColor(h)}"></i>`).join('')}</span></span>`;
  }
  const monthName = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const monthCount = Object.values(byDay).reduce((a, l) => a + l.length, 0);
  const isCur = y === now.getFullYear() && m === now.getMonth();

  // Séances par semaine sur 12 semaines (objectif : 3)
  const ws = weekStart();
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = ws - (11 - i) * 7 * 86400000;
    return { start, n: hist.filter(h => h.date >= start && h.date < start + 7 * 86400000).length };
  });
  const top = Math.max(4, ...weeks.map(w => w.n));
  const bars = weeks.map(w => `
      <span class="wk" aria-label="Semaine du ${new Date(w.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${plural(w.n, 'séance', 'séances')}">
        <span class="wk__bar ${w.n >= 3 ? 'wk__bar--ok' : ''}" style="height:${w.n / top * 100}%"></span>
      </span>`).join('');

  // Tuiles
  const vol  = hist.reduce((a, h) => a + sessionVolume(h.exercises || []), 0);
  const durs = hist.filter(h => h.duration > 0).map(h => h.duration);
  const avgD = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
  const streak = computeStreak();

  return `
    <div class="view stats-overview lot5">
      ${navBar({ title: 'Vue d\'ensemble' })}
      <div class="scr">
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${fmtVolume(vol)}</span><span class="tile__lbl">volume total</span></div>
          <div class="tile"><span class="tile__val num">${avgD ? fmtDuration(avgD) : '—'}</span><span class="tile__lbl">durée moyenne</span></div>
          <div class="tile"><span class="tile__val num">${streak}</span><span class="tile__lbl">${streak > 1 ? 'semaines' : 'semaine'} d'affilée</span></div>
        </div>
        <div class="group group--pad cal" id="ovCal">
          <div class="cal__head">
            <button class="cal__nav" data-action="ov-month" data-d="-1" aria-label="Mois précédent">${icon('chevron.left', 20)}</button>
            <span class="cal__title">${monthName.charAt(0).toUpperCase() + monthName.slice(1)}<span class="cal__count num">${plural(monthCount, 'séance', 'séances')}</span></span>
            <button class="cal__nav" data-action="ov-month" data-d="1" ${isCur ? 'disabled' : ''} aria-label="Mois suivant">${icon('chevron.right', 20)}</button>
          </div>
          <div class="cal__grid">
            ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="cal__wd" aria-hidden="true">${d}</span>`).join('')}
            ${cells}
          </div>
        </div>
        <div class="group-title">Séances par semaine</div>
        <div class="group group--pad">
          <div class="wks" role="img" aria-label="Séances par semaine sur 12 semaines, objectif 3">
            <span class="wks__goal" style="bottom:${3 / top * 100}%"><span>3</span></span>
            ${bars}
          </div>
          <div class="wks__axis"><span>il y a 12 sem.</span><span>cette semaine</span></div>
        </div>
      </div>
    </div>`;
}

// Balayage horizontal du calendrier : mois précédent / suivant
let calSwipe = null;
document.addEventListener('pointerdown', e => {
  if (!e.target.closest?.('#ovCal .cal__grid')) return;
  calSwipe = { x: e.clientX, y: e.clientY };
});
document.addEventListener('pointerup', e => {
  if (!calSwipe) return;
  const dx = e.clientX - calSwipe.x, dy = e.clientY - calSwipe.y;
  calSwipe = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) changeOvMonth(dx < 0 ? 1 : -1);
});
function changeOvMonth(d) {
  const now = new Date();
  let { y, m } = ovMonth;
  m += d;
  if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
  if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return;
  ovMonth = { y, m };
  render();
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'ov-month': (e, el) => {
    changeOvMonth(parseInt(el.dataset.d));
  },
});
