// ═══════════════════════════════════════════════════════════
//  Entraînement (accueil) : prochaine séance, récupération, chronos
// ═══════════════════════════════════════════════════════════
'use strict';

let ticker = null;

// Pastille de séance : initiale sur la couleur de la séance, ou l'emoji choisi pour une séance Perso
function catDot(cat, progId, size = 28) {
  progId = progId || data.activeProgramme;
  const meta = sessionMeta(cat, progId);
  return catBadge(rawLabel(cat, progId), meta.color, isUserProg(progId) ? meta.emoji : '', size);
}

// « dans 1 j 18 h », « dans 14 h », « dans 35 min » (jamais de secondes)
function fmtWait(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d} j${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${h < 3 && m ? ` ${pad(m)}` : ''}`;
  return `${m} min`;
}

// État de récupération d'une séance du programme affiché. Un délai passé à la main (skipped)
// compte comme une séance jamais faite, jusqu'à la séance suivante.
function catStatus(cat) {
  const p = prog();
  const t = p.timers[cat] || null;
  const last = t && !(p.skipped?.[cat] >= t) ? t : null;
  const cd = getCooldown(cat) * 3600_000;
  const remaining = last ? last + cd - Date.now() : 0;
  return { last, remaining, ready: remaining <= 0, progress: last ? Math.min(1, 1 - remaining / cd) : 1 };
}

// Anneau de récupération (28 px)
function recoveryRing(p) {
  const c = 2 * Math.PI * 11;
  return `<svg class="ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
    <circle cx="14" cy="14" r="11" class="ring__track"/>
    <circle cx="14" cy="14" r="11" class="ring__fill" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"/>
  </svg>`;
}

// Prochaine séance : la séance prête faite il y a le plus longtemps (ou jamais faite),
// sinon celle qui sera prête la première
function nextSessionCat(keys) {
  if (!keys.length) return null;
  const ready = keys.filter(k => catStatus(k).ready);
  if (ready.length) return ready.sort((a, b) => (catStatus(a).last || 0) - (catStatus(b).last || 0))[0];
  return keys.slice().sort((a, b) => catStatus(a).remaining - catStatus(b).remaining)[0];
}

function lastEntryOf(cat) {
  const p = data.activeProgramme;
  return (data.history || []).find(h => h.category === cat && (h.programme || 'ppl') === p) || null;
}

function cellStatusHtml(cat) {
  const st = catStatus(cat);
  if (activeSession && activeSession.category === cat && activeSession.programme === data.activeProgramme) {
    return `<span class="home-cell__status home-cell__status--live">En cours</span>`;
  }
  return st.ready
    ? `<span class="home-cell__status home-cell__status--ready">Prête</span>`
    : `<span class="home-cell__status">dans ${fmtWait(st.remaining)}</span>${recoveryRing(st.progress)}`;
}

function renderDashboard() {
  const keys = sessionKeys();
  const pm   = progMeta();
  const liveHere = activeSession && activeSession.programme === data.activeProgramme && keys.includes(activeSession.category);
  const next = liveHere ? activeSession.category : nextSessionCat(keys);

  let hero = '';
  if (next) {
    const meta = sessionMeta(next);
    const st   = catStatus(next);
    const last = lastEntryOf(next);
    let info, btn;
    if (liveHere) {
      info = `<div class="hero__info hero__info--live">En cours · <span class="num" id="hero-elapsed">${fmtClock(Date.now() - activeSession.startedAt)}</span></div>`;
      btn  = `<button class="hero__btn" data-action="resume-session">Reprendre</button>`;
    } else {
      info = last
        ? `<div class="hero__info">Dernière fois : ${fmtDate(last.date)} · ${fmtVolume(sessionVolume(last.exercises))}</div>`
        : `<div class="hero__info">Jamais faite</div>`;
      if (!st.ready) info += `<div class="hero__wait" id="hero-wait">Prochaine séance prête dans ${fmtWait(st.remaining)}</div>`;
      btn = st.ready
        ? `<button class="hero__btn" data-action="start-session" data-cat="${esc(next)}">Démarrer ${meta.label}</button>`
        : `<button class="hero__btn hero__btn--gray" data-action="start-session" data-cat="${esc(next)}">Démarrer quand même</button>`;
    }
    hero = `
      <section class="hero" aria-label="Prochaine séance" style="--cat-color:${meta.color}">
        <div class="hero__eyebrow">${liveHere ? 'Séance en cours' : 'Prochaine séance'}</div>
        <div class="hero__head">
          ${catDot(next)}
          <div class="hero__name">${meta.label}</div>
        </div>
        ${meta.desc ? `<div class="hero__desc">${meta.desc}</div>` : ''}
        ${info}
        ${btn}
        <button class="hero__link" data-action="go-editor" data-cat="${esc(next)}">Modifier les exercices</button>
      </section>`;
  }

  const others = keys.filter(k => k !== next).map(cat => {
    const meta = sessionMeta(cat);
    return `
      <button class="home-cell" data-action="session-actions" data-cat="${esc(cat)}">
        ${catDot(cat)}
        <span class="home-cell__name">${meta.label}</span>
        <span class="home-cell__right" data-status-cat="${esc(cat)}">${cellStatusHtml(cat)}</span>
      </button>`;
  }).join('');

  const streak = computeStreak();
  const streakCell = streak > 0 ? `
    <div class="list-group">
      <button class="home-cell home-cell--streak" data-action="go-stats">
        <span class="home-cell__icon" aria-hidden="true">${icon('flame', 22)}</span>
        <span class="home-cell__name">Régularité</span>
        <span class="home-cell__value">${streak} semaine${streak > 1 ? 's' : ''} d'affilée</span>
        <span class="home-cell__chev" aria-hidden="true">${icon('chevron.right', 14)}</span>
      </button>
    </div>` : '';

  const emptyCustom = isUserProg(data.activeProgramme) && keys.length === 0
    ? `<div class="empty-state">
         <div>Programme vide</div>
         <div class="empty-state__sub">Ajoute des séances dans l'onglet Programme</div>
       </div>`
    : '';

  const right = `<button class="navbar__icon" data-action="go-settings" aria-label="Réglages">${icon('gear', 24)}</button>`;
  const sub = `<button class="navbar__sub" data-action="go-programmes" aria-label="Programme ${esc(pm.name)}, changer de programme">Programme ${esc(pm.name)} ${icon('chevron.right', 12)}</button>`;

  return `
    <div class="view dashboard">
      ${navBar({ title: 'Entraînement', right, sub })}
      <div class="home">
        ${hero || emptyCustom}
        ${others ? `<div class="list-title">Autres séances</div><div class="list-group">${others}</div>` : ''}
        ${streakCell}
      </div>
    </div>`;
}

// Feuille d'actions d'une séance de l'accueil
async function sessionActions(cat) {
  const st = catStatus(cat);
  const choice = await dialog({ type: 'sheet', title: rawLabel(cat), actions: [
    { label: 'Démarrer', value: 'start', style: 'preferred' },
    ...(!st.ready ? [{ label: 'Passer le délai de récupération', value: 'skip' }] : []),
    { label: 'Voir les exercices', value: 'see' },
    { label: 'Annuler', style: 'cancel' },
  ] });
  if (choice === 'start') return startSessionFlow(cat);
  if (choice === 'skip') {
    const p = prog();
    (p.skipped ||= {})[cat] = Date.now();
    save(); render();
    showToast(`${rawLabel(cat)} est disponible`);
    return;
  }
  if (choice === 'see') {
    const list = (prog().exercises[cat] || []).map(ex => `
      <li class="sheet-list__row"><span>${esc(ex.name)}</span><span class="sheet-list__meta num">${ex.sets} série${ex.sets > 1 ? 's' : ''}</span></li>`).join('');
    await sheet({ title: rawLabel(cat), cancel: '', confirm: 'OK',
      body: list ? `<ul class="sheet-list">${list}</ul>` : '<p class="sheet-empty">Aucun exercice</p>' });
  }
}

// Mise à jour légère : chronos chaque seconde, délais de récupération à la minute
let tickerMinute = -1;
function startTicker() {
  clearInterval(ticker);
  tickerMinute = -1;
  const tick = () => {
    if (activeSession) {
      // Chrono de la séance (m:ss) : barre de la séance, mini-barre et accueil
      const clock = fmtClock(Date.now() - activeSession.startedAt);
      ['#session-clock', '#livebar-elapsed', '#hero-elapsed'].forEach(sel => { const el = $(sel); if (el) el.textContent = clock; });
      const lr = $('#livebar-rest');
      if (lr) { lr.hidden = !restActive; if (restActive) lr.textContent = fmtRest(restTimeLeft); }
    }
    if (currentView() !== 'dashboard') return;
    const minute = Math.floor(Date.now() / 60000);
    if (minute === tickerMinute) return;
    const first = tickerMinute === -1;
    tickerMinute = minute;
    if (first) return;
    // Une séance devient prête : on redessine l'accueil (la carte « Prochaine séance » peut changer)
    const keys = sessionKeys();
    const statusEl = k => $(`[data-status-cat="${CSS.escape(k)}"]`);
    if (keys.some(k => { const s = statusEl(k); return s && catStatus(k).ready && !s.querySelector('.home-cell__status--ready'); })
        || ($('#hero-wait') && catStatus(nextSessionCat(keys)).ready)) { render(); return; }
    keys.forEach(k => { const s = statusEl(k); if (s) s.innerHTML = cellStatusHtml(k); });
    const hw = $('#hero-wait');
    if (hw) hw.textContent = `Prochaine séance prête dans ${fmtWait(catStatus(nextSessionCat(keys)).remaining)}`;
  };
  tick();
  ticker = setInterval(tick, 1000);
}

// Démarrer une séance : refusée si elle est vide ; si une autre séance est en cours,
// on propose de la reprendre ou de l'abandonner
async function startSessionFlow(cat) {
  if (!(prog().exercises[cat] || []).length) {
    await dialog({ title: 'Aucun exercice', message: 'Ajoute des exercices à cette séance avant de la démarrer.', actions: [{ label: 'OK', style: 'preferred' }] });
    return;
  }
  if (activeSession) {
    const choice = await dialog({ type: 'sheet', title: 'Une séance est déjà en cours',
      message: `${rawLabel(activeSession.category, activeSession.programme)} a commencé il y a ${fmtDuration(Date.now() - activeSession.startedAt)}.`,
      actions: [
        { label: 'Reprendre la séance en cours', value: 'resume', style: 'preferred' },
        { label: `Abandonner et démarrer ${rawLabel(cat)}`, value: 'replace', style: 'destructive' },
        { label: 'Annuler', style: 'cancel' },
      ] });
    if (choice === 'resume') { navigate('session'); return; }
    if (choice !== 'replace') return;
    endSession();
  }
  if (data.soundOn !== false) beep(440, .08);
  haptic();
  startSession(cat);
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'session-actions': async (e, el) => {
    await sessionActions(el.dataset.cat);
  },
  'start-session': async (e, el) => {
    await startSessionFlow(el.dataset.cat);
  },
});
