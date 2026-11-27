// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : bloc « Charges par exercice » de la fiche Semaines (docs/COACH_WEB.md)
//
//  Même courbe que la fiche de l'élève dans l'app iPhone (« Charges par exercice ») : la série de travail la plus lourde
//  de chaque séance sur 12 semaines, exercice par exercice. Données : exerciseLoadSeries de js/data/coach-ex-progress.js,
//  chargé tel quel, sur les séances que la fiche a déjà lues (view.student.loads, main.js) ; géométrie : deskLoadChart
//  (model.js). Courbe dans la couleur du texte (l'orange est réservé aux boutons). Une bulle au survol, au toucher (au
//  clic, jamais au pointerdown) ou aux flèches du clavier ; un tableau caché à l'œil donne chaque séance aux lecteurs
//  d'écran. Bulle placée par le CSSOM (el.style) : la CSP n'autorise aucun attribut style.
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_LD_SHOWN = 6;   // exercices listés d'abord (les plus faits) ; « Voir les N exercices » pour le reste
// sel : élève → clé de l'exercice affiché (normName) ; all : liste entière dépliée ; shown : courbe dessinée (bulle)
const deskLd = { sel: new Map(), all: false, shown: null, tip: -1 };

function deskLdChange(ch) {
  if (!ch) return '';
  if (Math.abs(ch.kg) < 0.01) return `stable sur ${ch.weeks} sem.`;
  return `${deskSigned(ch.kg, ' kg')} en ${ch.weeks} sem.`;
}
const deskLdBubble = p => `${fmtDate(p.date, 'short')} · ${fmtNum(p.kg, 1)} kg × ${p.reps}`;

function deskLdChartHtml(c) {
  const pts = c.points.map(p => `${p.x},${p.y}`).join(' ');
  return `<figure class="group chart ldc"><svg viewBox="0 0 ${c.w} ${c.h}" role="img" tabindex="0" aria-label="${esc(c.desc)}. Flèches gauche et droite : séance par séance.">
    ${c.ticks.map(t => `<line class="gl" x1="4" x2="${c.right}" y1="${t.y}" y2="${t.y}"/><text class="ax" x="${c.right + 4}" y="${t.y + 3.5}">${esc(fmtNum(t.kg, 1))}</text>`).join('')}
    ${c.labels.map(l => `<text class="ax" x="${l.x}" y="${c.h - 5}" text-anchor="${l.anchor}">${esc(l.text)}</text>`).join('')}
    <line class="ld-guide" x1="0" x2="0" y1="8" y2="${c.h - 22}" visibility="hidden"/>
    <polyline class="ln" points="${pts}"/>
    ${c.points.map((p, i) => `<circle class="pt${i === c.points.length - 1 ? ' last' : ''}" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${i === c.points.length - 1 ? 3.2 : 2.2}"/>`).join('')}
  </svg><div class="ld-tip num" aria-hidden="true" hidden></div></figure>`;
}

// Bloc de la fiche : r = ligne de l'élève, loads = exerciseLoadSeries(séances lues)
function deskLoadsHtml(r, loads) {
  const head = `<h2 class="gh" id="h-loads">Charges par exercice <span class="r muted">12 semaines</span></h2>`;
  if (!loads?.length) {
    deskLd.shown = null;
    return `<section class="gblock ldb" aria-labelledby="h-loads">${head}<div class="group"><div class="row"><div class="grow muted">${esc(r.name)} n'a pas encore noté de charge sur 12 semaines.</div></div></div></section>`;
  }
  const sel = loads.find(x => x.key === deskLd.sel.get(r.id)) || loads[0];
  const c = deskLoadChart(sel);
  deskLd.shown = c ? { uid: r.id, points: c.points, w: c.w } : null;
  deskLd.tip = -1;
  const list = deskLd.all ? loads : loads.slice(0, DESK_LD_SHOWN);
  const rows = list.map((x, i) => {
    const on = x === sel, last = x.points[x.points.length - 1], ch = exerciseLoadChange(x);
    return `<button type="button" class="row ld-row${on ? ' on' : ''}" id="ld-${i}" data-ld="pick" data-key="${esc(x.key)}" aria-pressed="${on}">
      <span class="grow"><span class="blk">${esc(x.name)}</span><span class="t2 num blk">${esc(`${fmtNum(last.kg, 1)} kg × ${last.reps}`)} · ${esc(ch ? deskLdChange(ch) : plural(x.points.length, 'séance', 'séances'))}</span></span>
      ${on ? deskIcon('check', 'sm') : ''}</button>`;
  }).join('');
  const more = loads.length > DESK_LD_SHOWN ? `<button type="button" class="btn link more" id="ld-more" data-ld="more" aria-expanded="${deskLd.all}">${deskLd.all ? 'Voir moins d\'exercices' : `Voir les ${loads.length} exercices`}</button>` : '';
  const table = `<div class="sr"><table><caption>${esc(sel.name)} : série la plus lourde de chaque séance</caption>
    <thead><tr><th scope="col">Séance</th><th scope="col">Charge (kg)</th><th scope="col">Répétitions</th></tr></thead>
    <tbody>${sel.points.map(p => `<tr><th scope="row">${esc(fmtDate(p.date, 'short'))}</th><td>${esc(fmtNum(p.kg, 1))}</td><td>${p.reps}</td></tr>`).join('')}</tbody></table></div>`;
  const sub = c ? `${esc(sel.name)} · ${esc(`${fmtNum(c.first.kg, 1)} → ${fmtNum(c.last.kg, 1)} kg`)}${c.change ? `, ${esc(deskLdChange(c.change))}` : ''}` : `${esc(sel.name)} : une seule séance pour l'instant, la courbe apparaît à la deuxième.`;
  return `<section class="gblock ldb" aria-labelledby="h-loads">${head}
    ${c ? deskLdChartHtml(c) : ''}${table}
    <div class="gfoot ld-sub num">${sub}</div>
    <div class="group ld-list" role="group" aria-label="Exercices de ${esc(r.name)}">${rows}</div>${more}
    <div class="gfoot">La série la plus lourde de chaque séance, sans l'échauffement, comme dans l'app iPhone.</div></section>`;
}

// Bulle sur le point i de la courbe affichée (-1 : cachée)
function deskLdTip(i) {
  const fig = document.querySelector('.ldc'), s = deskLd.shown;
  if (!fig || !s) return;
  const tip = fig.querySelector('.ld-tip'), svg = fig.querySelector('svg'), guide = fig.querySelector('.ld-guide');
  fig.querySelectorAll('circle.on').forEach(el => el.classList.remove('on'));
  deskLd.tip = i;
  if (i < 0 || !s.points[i]) { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); return; }
  const p = s.points[i];
  fig.querySelector(`circle[data-i="${i}"]`)?.classList.add('on');
  guide.setAttribute('x1', p.x); guide.setAttribute('x2', p.x); guide.setAttribute('visibility', 'visible');
  tip.textContent = deskLdBubble(p);
  tip.hidden = false;
  const box = svg.getBoundingClientRect(), fbox = fig.getBoundingClientRect();
  const k = box.width / s.w, half = tip.offsetWidth / 2;
  const x = box.left - fbox.left + p.x * k;
  tip.style.left = `${Math.round(Math.min(fbox.width - half - 4, Math.max(half + 4, x)))}px`;
  // Point trop haut pour la bulle (le cadre la couperait) : dessous
  const y = box.top - fbox.top + p.y * k, below = y - tip.offsetHeight - 12 < 0;
  tip.classList.toggle('below', below);
  tip.style.top = `${Math.round(below ? y + 12 : y - 12)}px`;
}
// Point le plus proche d'un geste (abscisse seulement : la courbe se lit de gauche à droite)
function deskLdNearest(e) {
  const svg = document.querySelector('.ldc svg'), s = deskLd.shown;
  if (!svg || !s) return -1;
  const box = svg.getBoundingClientRect();
  const x = (e.clientX - box.left) * s.w / box.width;
  let best = 0;
  s.points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(s.points[best].x - x)) best = i; });
  return best;
}

document.addEventListener('pointermove', e => { if (e.pointerType !== 'touch' && e.target.closest?.('.ldc svg')) deskLdTip(deskLdNearest(e)); }, { passive: true });
document.addEventListener('pointerout', e => {
  if (e.pointerType !== 'touch' && e.target.closest?.('.ldc svg') && !e.relatedTarget?.closest?.('.ldc svg') && document.activeElement !== e.target.closest('svg')) deskLdTip(-1);
});
document.addEventListener('click', e => {
  if (e.target.closest?.('.ldc svg')) { deskLdTip(deskLdNearest(e)); return; }
  const el = e.target.closest?.('[data-ld]');
  if (!el) { if (deskLd.tip >= 0 && !e.target.closest?.('.ldc')) deskLdTip(-1); return; }
  if (el.dataset.ld === 'more') { deskLd.all = !deskLd.all; deskRender(); return; }
  const uid = view.student?.id;
  if (!uid || deskLd.sel.get(uid) === el.dataset.key) return;
  deskLd.sel.set(uid, el.dataset.key);
  deskRender();
  deskAnnounce(`Courbe : ${el.querySelector('.blk')?.textContent || ''}`);
});
document.addEventListener('keydown', e => {
  if (!e.target.closest?.('.ldc svg') || !deskLd.shown) return;
  const n = deskLd.shown.points.length;
  let i = deskLd.tip;
  if (e.key === 'ArrowRight') i = i < 0 ? n - 1 : Math.min(n - 1, i + 1);
  else if (e.key === 'ArrowLeft') i = i < 0 ? n - 1 : Math.max(0, i - 1);
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = n - 1;
  else if (e.key === 'Escape') { deskLdTip(-1); return; }
  else return;
  e.preventDefault();
  deskLdTip(i);
  deskAnnounce(deskLdBubble(deskLd.shown.points[i]));
});
document.addEventListener('focusout', e => { if (e.target.closest?.('.ldc svg')) deskLdTip(-1); });
