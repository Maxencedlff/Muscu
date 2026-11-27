// ═══════════════════════════════════════════════════════════
//  Coach : progression des charges d'un élève, exercice par exercice (retours de Sophie, coach, 26/11/2026).
//  Fiche de l'élève : une ligne « Charges par exercice » (son exercice le plus fait et son écart sur la période).
//  Écran `coach-ex-progress:UID` : la courbe de l'exercice choisi sur 12 semaines (la plus lourde série de chaque
//  séance), puis la liste de ses exercices ; un toucher sur un exercice change la courbe. Logique :
//  js/data/coach-ex-progress.js. Rien au pointerdown : tout s'ouvre au clic.
// ═══════════════════════════════════════════════════════════
'use strict';

const expSel = new Map();   // élève → clé de l'exercice affiché (normName)
const EXP_PAGES_MAX = 6;    // pages de séances lues au plus pour couvrir les 12 semaines (30 par page)

const expKg = kg => `${fmtW(kg)} ${unitLbl()}`;
// « +7,5 kg en 6 sem. », « Stable sur 4 sem. », « −5 kg en 3 sem. »
function expChangeText(ch) {
  if (!ch) return '';
  const w = `${ch.weeks} sem.`;
  if (Math.abs(ch.kg) < 0.01) return `Stable sur ${w}`;
  return `${ch.kg > 0 ? '+' : '−'}${fmtW(Math.abs(ch.kg))} ${unitLbl()} en ${w}`;
}

// Ligne de la fiche : rien tant que ses séances ne sont pas lues, ni s'il n'a aucune charge notée
function coachExProgressCellHtml(uid) {
  const f = coachSessions(uid);
  if (!f.loadedAt) return '';
  const series = exerciseLoadSeries(f.rows).filter(x => x.points.length >= 2);
  if (!series.length) return '';
  const top = series[0], p = top.points, ch = exerciseLoadChange(top);
  const sub = `${top.name} : ${expKg(p[0].kg)} → ${expKg(p[p.length - 1].kg)}${ch ? `, ${expChangeText(ch).toLowerCase()}` : ''}`;
  return `
        <div class="group-title">Progression</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-ex-progress" data-uid="${esc(uid)}">
            <span class="coach-cell__icon" aria-hidden="true">${icon('chart', 20)}</span>
            <span class="cell__body"><span class="cell__title">Charges par exercice</span><span class="cell__sub num">${esc(sub)}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

function renderCoachExProgress(uid) {
  const p = coachStudent(uid), f = coachSessions(uid);
  const head = navBar({ title: 'Charges', large: false });
  if (!p) return `<div class="view view--grouped coach-exp-view">${head}<div class="scr"><div class="empty-note">Cette personne ne fait plus partie de tes élèves.</div></div></div>`;
  const who = esc(personName(p));
  const series = exerciseLoadSeries(f.rows);
  if (!series.length) {
    const msg = f.loading || !f.loadedAt ? 'Chargement…' : f.error ? 'Pas d\'Internet. Ses charges s\'afficheront quand le réseau reviendra.' : `${who} n'a pas encore noté de charge.`;
    return `<div class="view view--grouped coach-exp-view">${head}<div class="scr"><h1 class="scr-title">${who}</h1><div class="empty-note">${msg}</div></div></div>`;
  }
  const sel = series.find(x => x.key === expSel.get(uid)) || series[0];
  const pts = sel.points, last = pts[pts.length - 1], ch = exerciseLoadChange(sel);
  chartState = pts.length > 1 ? {
    vals: pts.map(x => toUnitW(x.kg)), dates: pts.map(x => x.date), points: pts, bw: false, mode: 'weight', color: 'var(--teal)',
    xLabels: [], sel: null, name: sel.name, fromZero: false,
    fmtVal: v => `${fmtNum(v, 1)} ${unitLbl()}`, axisFmt: v => fmtNum(Math.round(v * 10) / 10),
    bubble: x => `${fmtDate(x.date, 'short')} · ${expKg(x.kg)} × ${x.reps}`,
  } : null;
  const spoken = `${sel.name} : ${pts.map(x => `${fmtDate(x.date, 'short')}, ${fmtW(x.kg)} ${unitLbl() === 'kg' ? 'kilos' : 'livres'}`).join(' ; ')}`;
  const rows = series.map(x => {
    const on = x === sel, c = exerciseLoadChange(x), xl = x.points[x.points.length - 1];
    return `
          <button class="cell coach-exp-row${on ? ' coach-exp-row--on' : ''}" data-action="coach-ex-pick" data-uid="${esc(uid)}" data-key="${esc(x.key)}" aria-pressed="${on}">
            <span class="cell__body"><span class="cell__title">${esc(x.name)}</span><span class="cell__sub num">${esc(`${expKg(xl.kg)} × ${xl.reps}`)}${c ? ` · ${esc(expChangeText(c))}` : ` · ${plural(x.points.length, 'séance', 'séances')}`}</span></span>
            ${on ? `<span class="coach-exp-row__on" aria-hidden="true">${icon('checkmark', 16)}</span>` : ''}
          </button>`;
  }).join('');
  const covered = exerciseLoadCovered(f);
  return `
    <div class="view view--grouped coach-exp-view">
      ${head}
      <div class="scr">
        <h1 class="scr-title">${esc(sel.name)}</h1>
        <p class="scr-sub num">${who} · ${esc(`${expKg(last.kg)} × ${last.reps}`)} le ${esc(fmtDate(last.date, 'short'))}${ch ? ` · ${esc(expChangeText(ch))}` : ''}</p>
        ${chartState ? `<div class="chart" id="exChart">
          <canvas class="stats-canvas" role="img" aria-label="${esc(spoken)}"></canvas>
          <div class="chart-bubble num" hidden></div>
        </div>` : `<div class="empty-note">Une seule séance pour l'instant : la courbe apparaît à la deuxième.</div>`}
        <div class="group-foot">La série la plus lourde de chaque séance, sans l'échauffement, sur ${covered ? `les ${EXP_WEEKS} dernières semaines` : 'ses séances reçues'}.</div>
        <div class="group-title">Ses exercices</div>
        <div class="group">${rows}</div>
      </div>
    </div>`;
}

// Arrivée : ses séances lues jusqu'à couvrir les 12 semaines (6 pages au plus)
async function coachExProgressLoad(uid) {
  let f = coachSessions(uid);
  if (!f.loadedAt && !(await coachLoadSessions(uid)).ok) return;
  for (let i = 0; i < EXP_PAGES_MAX; i++) {
    f = coachSessions(uid);
    if (exerciseLoadCovered(f) || f.end) break;
    if (!(await coachLoadSessions(uid, { more: true })).ok) break;
  }
  if (currentView() === 'coach-ex-progress') render();
}

SCREENS.set('coach-ex-progress', {
  render: uid => { chartState = null; return renderCoachExProgress(uid); },
  mount: () => { if ($('#exChart')) drawCharts(); },
  enter: () => { const uid = routeParams(currentRoute())[0]; if (uid) coachExProgressLoad(uid); },
});

registerActions({
  'coach-ex-progress': (e, el) => navigate(makeRoute('coach-ex-progress', el.dataset.uid)),
  'coach-ex-pick': (e, el) => {
    if (expSel.get(el.dataset.uid) === el.dataset.key) return;
    expSel.set(el.dataset.uid, el.dataset.key);
    haptic();
    render();
    window.scrollTo(0, 0);
    announce(`Courbe : ${el.querySelector('.cell__title')?.textContent || ''}`);
  },
});
