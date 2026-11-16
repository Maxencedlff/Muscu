// ═══════════════════════════════════════════════════════════
//  Historique : calendrier du mois, en tête de la liste
// ═══════════════════════════════════════════════════════════
// Retour de Maxence du 16/11 : « pourquoi voir l'historique sur un calendrier dans Progrès et pas dans Historique ? ».
// Le calendrier de Progrès › Vue d'ensemble est venu ici (Vue d'ensemble garde ses tuiles et ses séances par semaine).
// Compact (un point par séance, gris comme le reste de l'Historique), ouvert et fermé par le bouton calendrier de la barre
// de navigation (fermé par défaut, choix gardé sur l'appareil), il suit
// le filtre de séance. Toucher un jour qui a des séances les montre sous le calendrier, en cartes illustrées comme la
// liste ; toucher le même jour les cache. Aucun geste au doigt posé : tout se fait au toucher (click).
'use strict';

let histCalMonth = null;   // { y, m } du mois affiché, mois en cours par défaut
let histCalDay   = null;   // 'AAAA-MM-JJ' du jour ouvert (ses séances sous le calendrier), ou null
const HIST_CAL_KEY = 'mdlf_hist_cal';   // '1' : déplié (commodité de l'appareil, rien de synchronisé)

// Fermé par défaut : la liste garde ses trois cartes entières à l'écran sur iPhone SE (calendrier ouvert : plus de la
// moitié de l'écran). Ouvert une fois, il le reste.
function histCalOpen() {
  try { return localStorage.getItem(HIST_CAL_KEY) === '1'; } catch { return false; }
}
function histCalSetOpen(open) {
  try { localStorage.setItem(HIST_CAL_KEY, open ? '1' : '0'); } catch { /* navigation privée : replié jusqu'au prochain rendu */ }
}

// Séances du filtre en cours (la recherche ne compte pas : le calendrier montre le mois, pas des résultats)
function histCalEntries() {
  const name = histFilter === 'all' ? '' : historyFilterName(histFilter);
  return [...(data.history || []), ...healthEntries()].filter(h => historyFilterHit(h, name));
}

function histCalHtml() {
  if (!histCalOpen()) return '<div id="histCalBox" hidden></div>';
  const now = new Date();
  if (!histCalMonth) histCalMonth = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = histCalMonth;
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  histCalEntries().forEach(h => {
    const d = new Date(h.date);
    if (d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] ||= []).push(h);
  });
  const count = Object.values(byDay).reduce((a, l) => a + l.length, 0);
  const month = capitalize(fmtDate(first, 'month'));
  const isCur = y === now.getFullYear() && m === now.getMonth();
  const today = isCur ? now.getDate() : 0;
  let cells = '';
  for (let i = 0; i < dayIndexInWeek(first); i++) cells += '<span class="cal__d cal__d--empty" aria-hidden="true"></span>';
  for (let d = 1; d <= days; d++) {
    const hs = (byDay[d] || []).sort((a, b) => a.date - b.date);
    const dots = `<span class="cal__dots" aria-hidden="true">${hs.slice(0, 3).map(() => '<i></i>').join('')}</span>`;
    const cls = `cal__d${d === today ? ' cal__d--today' : ''}`;
    if (!hs.length) { cells += `<span class="${cls}" aria-hidden="true"><span class="num">${d}</span>${dots}</span>`; continue; }
    const key = localISO(new Date(y, m, d));
    const names = hs.map(h => (isHealthEntry(h) ? h.health.title : historyEntryLabel(h))).join(', ');
    cells += `<button class="${cls} cal__d--has" data-action="hcal-day" data-day="${key}" aria-pressed="${histCalDay === key}"
      aria-label="${d} ${esc(fmtDate(new Date(y, m, d), 'month'))}, ${esc(names)}"><span class="num">${d}</span>${dots}</button>`;
  }
  return `<div id="histCalBox">
      <section class="group group--pad cal hcal" id="histCal" aria-label="Calendrier">
        <div class="cal__head">
          <button class="cal__nav" data-action="hcal-month" data-d="-1" aria-label="Mois précédent">${icon('chevron.left', 20)}</button>
          <h2 class="cal__title">${month}<span class="cal__count num">${plural(count, 'séance', 'séances')}</span></h2>
          <button class="cal__nav" data-action="hcal-month" data-d="1" ${isCur ? 'disabled' : ''} aria-label="Mois suivant">${icon('chevron.right', 20)}</button>
        </div>
        <div class="cal__grid" id="histCalGrid">
          ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="cal__wd" aria-hidden="true">${d}</span>`).join('')}
          ${cells}
        </div>
      </section>
      ${histCalDayHtml(byDay)}
    </div>`;
}

// Séances du jour ouvert, sous le calendrier : les cartes de la liste (personnage compris)
function histCalDayHtml(byDay) {
  if (!histCalDay) return '';
  const [y, m, d] = histCalDay.split('-').map(Number);
  if (y !== histCalMonth.y || m - 1 !== histCalMonth.m || !byDay[d]?.length) return '';
  const index = chosenMusclesIndex(), labels = historyNameLabels();
  return `<section class="hmonth hcal-day" aria-label="Séances du ${d} ${esc(fmtDate(new Date(y, m - 1, d), 'month'))}">
      <h2 class="hmonth__title">${capitalize(fmtDate(new Date(y, m - 1, d), 'long'))}</h2>
      <div class="group">${byDay[d].map(h => historyCell(h, index, labels)).join('')}</div>
    </section>`;
}

// Bouton de la barre de navigation (à gauche du +) : ouvre et ferme le calendrier ; fermé, il ne prend aucune place
// (la liste garde ses trois cartes entières à l'écran sur iPhone SE)
function histCalBtnHtml() {
  const open = histCalOpen();
  return `<button class="navbar__icon hcal-btn${open ? ' hcal-btn--on' : ''}" data-action="hcal-toggle" aria-expanded="${open}" aria-label="Calendrier">${icon('calendar', 22)}</button>`;
}

// Redessiné sur place (filtre, suppression, mois, jour) ; focus rendu au bouton touché pour VoiceOver
function refreshHistoryCalendar(focusSel = null) {
  const el = $('#histCalBox');
  if (!el) return;
  el.outerHTML = histCalHtml();
  if (focusSel) $(`#histCalBox ${focusSel}`)?.focus({ preventScroll: true });
}

function changeHistCalMonth(delta) {
  const now = new Date();
  let { y, m } = histCalMonth || { y: now.getFullYear(), m: now.getMonth() };
  m += delta;
  if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
  if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return;
  histCalMonth = { y, m };
  histCalDay = null;
  refreshHistoryCalendar(`[data-action="hcal-month"][data-d="${delta}"]:not([disabled])`);
}

registerActions({
  'hcal-toggle': (e, el) => {
    const open = !histCalOpen();
    histCalSetOpen(open);
    histCalDay = null;
    el.setAttribute('aria-expanded', String(open));
    el.classList.toggle('hcal-btn--on', open);
    haptic();
    refreshHistoryCalendar();
    if (open) $('#histScroll')?.scrollTo?.({ top: 0 });
  },
  'hcal-month': (e, el) => changeHistCalMonth(parseInt(el.dataset.d)),
  'hcal-day': (e, el) => {
    histCalDay = histCalDay === el.dataset.day ? null : el.dataset.day;
    refreshHistoryCalendar(`[data-day="${histCalDay || el.dataset.day}"]`);
    if (histCalDay) $('.hcal-day')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
});
