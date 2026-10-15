// ═══════════════════════════════════════════════════════════
//  Historique : liste, recherche, détail, suppression
// ═══════════════════════════════════════════════════════════
'use strict';

let historyId  = null;
let histFilter = 'all';
let histQuery  = '';
let histMonths = 3;

function historySorted() {
  return (data.history || []).slice().sort((a, b) => b.date - a.date);
}

function historyMatches(h, q) {
  if (histFilter !== 'all' && !(h.category === histFilter && (h.programme || 'ppl') === data.activeProgramme)) return false;
  if (!q) return true;
  if (normName(h.notes).includes(q)) return true;
  return (h.exercises || []).some(e => normName(e.name).includes(q));
}

function historyCell(h) {
  const progId = h.programme || 'ppl';
  const meta   = sessionMeta(h.category, progId);
  const vol    = sessionVolume(h.exercises || []);
  // Séance d'un autre programme : la mention remplace le nombre d'exercices (cellule sur 2 lignes)
  const other  = progId !== data.activeProgramme;
  const parts  = [other ? `Programme ${progMeta(progId).name}` : plural((h.exercises || []).length, 'exercice', 'exercices')];
  if (vol > 0) parts.push(fmtVolume(vol));
  if (h.duration) parts.push(fmtDuration(h.duration));
  return `
    <div class="hrow" data-id="${esc(h.id)}">
      <button class="hrow__del" data-action="swipe-delete-session" data-id="${esc(h.id)}" tabindex="-1">Supprimer</button>
      <button class="hcell" data-action="open-history" data-id="${esc(h.id)}">
        <span class="hcell__dot" style="background:${meta.color}"></span>
        <span class="hcell__body">
          <span class="hcell__top"><span class="hcell__title">${meta.label}</span><span class="hcell__date">${fmtDate(h.date)}</span></span>
          <span class="hcell__sub num">${parts.join(' · ')}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>
    </div>`;
}

function historyListHTML() {
  const q   = normName(histQuery);
  const all = historySorted().filter(h => historyMatches(h, q));
  if (!all.length) {
    return (data.history || []).length
      ? `<div class="empty-note">Aucune séance ne correspond.</div>`
      : `<div class="empty-note">Aucune séance enregistrée.<br>Termine ta première séance pour la voir ici.</div>`;
  }
  let out = '', months = 0, curKey = null, buf = '', i = 0;
  const flush = () => { if (curKey) out += `<section class="hmonth" data-month="${curKey}"><h2 class="hmonth__title">${buf.title}</h2><div class="group">${buf.rows}</div></section>`; };
  for (; i < all.length; i++) {
    const h = all[i], d = new Date(h.date);
    const key = d.getFullYear() + '-' + d.getMonth();
    if (key !== curKey) {
      flush();
      months++;
      if (months > histMonths) break;
      curKey = key;
      const t = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      buf = { title: t.charAt(0).toUpperCase() + t.slice(1), rows: '' };
    }
    buf.rows += historyCell(h);
  }
  if (i >= all.length) flush();
  if (i < all.length) out += `<button class="btn-more" data-action="hist-more">Afficher plus</button>`;
  return out;
}

function renderHistory() {
  const keys = sessionKeys();
  if (histFilter !== 'all' && !keys.includes(histFilter)) histFilter = 'all';
  return `
    <div class="view history lot5">
      ${navBar({ title: 'Historique', right: `<button class="navbar__icon" data-action="go-add-session" aria-label="Ajouter une séance passée">${icon('plus', 24)}</button>`  })}
      <div class="scr" id="histScroll">
        <div class="hist-tools">
          <input type="search" id="histSearch" class="search" placeholder="Rechercher" value="${esc(histQuery)}"
                 autocomplete="off" enterkeyhint="search" aria-label="Rechercher dans l'historique">
          <div class="segmented seg-full seg-scroll" role="group" aria-label="Filtrer par séance">
            ${[['all', 'Toutes'], ...keys.map(k => [k, sessionMeta(k).label])].map(([k, l]) =>
              `<button class="segmented__btn ${histFilter === k ? 'segmented__btn--active' : ''}" aria-pressed="${histFilter === k}" data-action="hist-filter" data-cat="${esc(k)}">${l}</button>`).join('')}
          </div>
        </div>
        <div id="histList">${historyListHTML()}</div>
      </div>
    </div>`;
}

function refreshHistoryList() {
  const el = $('#histList');
  if (el) el.innerHTML = historyListHTML();
}

// Séries d'un exercice : poids mis en facteur s'il ne change pas
function setsLine(sets) {
  const ok = (sets || []).filter(s => String(s.reps ?? '') !== '');
  if (!ok.length) return '—';
  const ws = ok.map(s => parseFloat(s.weight) || 0);
  if (ws.every(w => w === 0)) return `${ok.map(s => esc(s.reps)).join(' · ')} reps`;
  if (ws.every(w => w === ws[0])) return `${wFr(ok[0].weight)} ${unitLbl()} × ${ok.map(s => esc(s.reps)).join(' · ')}`;
  return ok.map(s => `${parseFloat(s.weight) > 0 ? wFr(s.weight) + ' × ' : ''}${esc(s.reps)}`).join(' · ');
}

function renderHistoryDetail() {
  const h = (data.history || []).find(x => x.id === historyId);
  if (!h) {
    return `<div class="view history-detail lot5">${navBar({ title: 'Séance' })}
      <div class="scr"><div class="empty-note">Cette séance n'existe plus.</div></div></div>`;
  }
  const progId = h.programme || 'ppl';
  const meta   = sessionMeta(h.category, progId);
  const d      = new Date(h.date);
  let when = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  when = when.charAt(0).toUpperCase() + when.slice(1);
  // L'heure n'a de sens que pour une séance chronométrée (une séance passée n'a pas d'heure)
  if (h.duration) when += ` · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const vol  = sessionVolume(h.exercises || []);
  const nSets = (h.exercises || []).reduce((a, e) => a + (e.sets || []).length, 0);
  return `
    <div class="view history-detail lot5">
      ${navBar({ title: '', right: `<button class="navbar__text" data-action="edit-session" data-id="${esc(h.id)}">Modifier</button>`  })}
      <div class="scr">
        <h1 class="scr-title"><span class="hcell__dot hcell__dot--lg" style="background:${meta.color}"></span>${meta.label}</h1>
        <p class="scr-sub">${when}${progId !== data.activeProgramme ? ` · Programme ${progMeta(progId).name}` : ''}</p>
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${h.duration ? fmtDuration(h.duration) : '—'}</span><span class="tile__lbl">durée</span></div>
          <div class="tile"><span class="tile__val num">${vol > 0 ? fmtVolume(vol) : '—'}</span><span class="tile__lbl">volume</span></div>
          <div class="tile"><span class="tile__val num">${nSets}</span><span class="tile__lbl">${nSets > 1 ? 'séries' : 'série'}</span></div>
        </div>
        <div class="group-title">Exercices</div>
        <div class="group">
          ${(h.exercises || []).map(e => `
            <div class="cell hex">
              <span class="cell__body">
                <span class="hex__name">${esc(e.name)}</span>
                <span class="hex__sets num">${setsLine(e.sets)}</span>
              </span>
            </div>`).join('')}
        </div>
        ${h.notes ? `<div class="group-title">Notes</div><div class="group group--pad"><p class="hnotes">${esc(h.notes)}</p></div>` : ''}
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="delete-session" data-id="${esc(h.id)}">Supprimer la séance</button>
        </div>
      </div>
    </div>`;
}

// Supprime une séance de la liste sans re-rendu complet, avec « Annuler » pendant 5 s
function deleteSessionWithUndo(id) {
  const list = data.history || [];
  const idx  = list.findIndex(h => h.id === id);
  if (idx < 0) return;
  const [removed] = list.splice(idx, 1);
  syncTimersFromHistory();
  recomputePRFromHistory();
  save();
  const row = document.querySelector(`.hrow[data-id="${CSS.escape(id)}"]`);
  if (row) {
    const sec = row.closest('.hmonth');
    row.remove();
    if (sec && !sec.querySelector('.hrow')) sec.remove();
  }
  showToast('Séance supprimée', {
    action: 'Annuler', duration: 5000,
    onAction: () => {
      data.history.splice(Math.min(idx, data.history.length), 0, removed);
      syncTimersFromHistory();
      recomputePRFromHistory();
      save();
      if (view === 'history') refreshHistoryList();
    },
  });
}

// Balayage vers la gauche sur une cellule de l'historique : révèle « Supprimer »
let hSwipe = null;
let suppressClick = false;
const SWIPE_W = 88;
function closeOpenRows(except) {
  document.querySelectorAll('.hrow.is-open').forEach(r => { if (r !== except) { r.classList.remove('is-open'); r.querySelector('.hcell').style.transform = ''; } });
}
document.addEventListener('pointerdown', e => {
  const cell = e.target.closest?.('.hcell');
  if (!cell || view !== 'history') { if (!e.target.closest?.('.hrow__del')) closeOpenRows(); return; }
  const row = cell.parentElement;
  closeOpenRows(row);
  hSwipe = { row, cell, x: e.clientX, y: e.clientY, base: row.classList.contains('is-open') ? -SWIPE_W : 0, axis: null, dx: 0, id: e.pointerId };
});
document.addEventListener('pointermove', e => {
  if (!hSwipe || e.pointerId !== hSwipe.id) return;
  const dx = e.clientX - hSwipe.x, dy = e.clientY - hSwipe.y;
  if (!hSwipe.axis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    hSwipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (hSwipe.axis === 'x') { hSwipe.cell.classList.add('is-swiping'); hSwipe.row.classList.add('is-swipe'); try { hSwipe.cell.setPointerCapture(e.pointerId); } catch {} }
  }
  if (hSwipe.axis !== 'x') return;
  hSwipe.dx = dx;
  const t = Math.max(-SWIPE_W * 1.3, Math.min(0, hSwipe.base + dx));
  hSwipe.cell.style.transform = `translateX(${t}px)`;
});
function endHSwipe(e) {
  if (!hSwipe || e.pointerId !== hSwipe.id) return;
  const s = hSwipe; hSwipe = null;
  s.cell.classList.remove('is-swiping');
  s.row.classList.remove('is-swipe');
  if (s.axis !== 'x') return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);
  const open = s.base + s.dx < -SWIPE_W / 2;
  s.row.classList.toggle('is-open', open);
  s.cell.style.transform = open ? `translateX(${-SWIPE_W}px)` : '';
}
document.addEventListener('pointerup', endHSwipe);
document.addEventListener('pointercancel', endHSwipe);
// Le clic qui suit un balayage n'ouvre pas la séance ; une cellule ouverte se referme au tap
document.addEventListener('click', e => {
  const cell = e.target.closest?.('.hcell');
  if (!cell) return;
  if (suppressClick || cell.parentElement.classList.contains('is-open')) {
    e.stopImmediatePropagation(); e.preventDefault();
    if (!suppressClick) { cell.parentElement.classList.remove('is-open'); cell.style.transform = ''; }
  }
}, true);

// Recherche dans l'historique : seule la liste est redessinée (le champ garde le focus)
document.addEventListener('input', e => {
  if (e.target.id === 'histSearch') { histQuery = e.target.value; histMonths = 3; refreshHistoryList(); }
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-history': (e, el) => {
    if (el.closest('.tabbar')) switchTab('history'); else navigate('history');
  },
  'open-history': (e, el) => {
    historyId = el.dataset.id; view = 'history-detail'; render();
  },
  'hist-filter': (e, el) => {
    histFilter = el.dataset.cat; histMonths = 3;
    document.querySelectorAll('[data-action="hist-filter"]').forEach(b => {
      const on = b.dataset.cat === histFilter;
      b.classList.toggle('segmented__btn--active', on); b.setAttribute('aria-pressed', on);
    });
    refreshHistoryList();
  },
  'hist-more': () => {
    histMonths += 3; refreshHistoryList();
  },
  'swipe-delete-session': (e, el) => {
    deleteSessionWithUndo(el.dataset.id);
  },
  'delete-session': async (e, el) => {
    if (!(await confirmSheet('Supprimer cette séance ?', 'Elle sera retirée de l\'historique et des statistiques.', 'Supprimer la séance'))) return;
    data.history = (data.history || []).filter(h => h.id !== el.dataset.id);
    syncTimersFromHistory();
    recomputePRFromHistory();
    if (view === 'history-detail') view = 'history';
    save(); render();
  },
});
