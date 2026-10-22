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

// État de récupération d'une séance du programme affiché.
// Par muscle : la séance attend que ses muscles principaux se reposent, où qu'ils aient travaillé
// (autre programme, séance libre, moitié d'un double split) ; seuls les muscles principaux d'un
// exercice comptent (les biceps d'un rowing ne bloquent pas une séance biceps). Séance dont aucun
// muscle n'est connu : délai de la séance elle-même, comme avant. Un délai passé à la main (skipped)
// libère la séance jusqu'au prochain entraînement de ces muscles.
// by : { muscle, entry } qui fixe le délai quand il vient d'ailleurs que cette séance, sinon null.
function catStatus(cat) {
  const p = prog();
  const own = p.timers[cat] || null;
  const rec = sessionRecovery(cat);
  let last = own, by = null;
  if (rec && rec.date > (own || 0)) {
    last = rec.date;
    const e = rec.entry;
    if (!(e.category === cat && (e.programme || 'ppl') === data.activeProgramme)) by = rec;
  }
  if (last && p.skipped?.[cat] >= last) { last = null; by = null; }
  const cd = getCooldown(cat) * 3600_000;
  const remaining = last ? last + cd - Date.now() : 0;
  return { last, remaining, ready: remaining <= 0, progress: last ? Math.min(1, 1 - remaining / cd) : 1, by: remaining > 0 ? by : null };
}

// Dernier entraînement (muscle principal, au moins une série) de chaque muscle, sur tout l'historique.
// Gardé tant que l'historique et les muscles déclarés ne changent pas (l'accueil le lit pour chaque séance).
let muscleLastCache = { key: null, map: null };
function muscleLastWorked() {
  const h = data.history || [];
  const key = `${h.length}:${h[0]?.id}:${h[0]?.date}:${JSON.stringify(data.exerciseMuscles || {})}:${JSON.stringify([...chosenMusclesIndex()])}`;
  if (muscleLastCache.key === key) return muscleLastCache.map;
  const map = new Map(), index = chosenMusclesIndex();
  h.forEach(entry => (entry.exercises || []).forEach(e => {
    if (!(e.sets || []).some(s => (parseInt(s?.reps) || 0) > 0)) return;
    exerciseMuscles(e, index).primary.forEach(m => {
      if (!(map.get(m)?.date >= entry.date)) map.set(m, { date: entry.date, entry });
    });
  }));
  muscleLastCache = { key, map };
  return map;
}

// Muscle principal de la séance travaillé le plus récemment : { muscle, date, entry } ou null
function sessionRecovery(cat) {
  const index = chosenMusclesIndex();
  const muscles = new Set((prog().exercises[cat] || []).flatMap(ex => exerciseMuscles(ex, index).primary));
  if (!muscles.size) return null;
  const last = muscleLastWorked();
  let best = null;
  muscles.forEach(m => { const w = last.get(m); if (w && !(best?.date >= w.date)) best = { muscle: m, ...w }; });
  return best;
}

// « Biceps : hier, Bras & épaules » : pourquoi une séance attend à cause d'une autre
function recoveryReason(by) {
  const startOfDay = t => new Date(t).setHours(0, 0, 0, 0);
  const e = by.entry, pid = e.programme || 'ppl';
  const where = pid === FREE ? 'séance libre'
    : pid === data.activeProgramme ? rawLabel(e.category, pid) : progMeta(pid).name;
  const days = Math.round((startOfDay(Date.now()) - startOfDay(e.date)) / 86400000);
  const when = days <= 0 ? 'aujourd\'hui' : days === 1 ? 'hier' : `il y a ${days} jours`;
  return `${muscleLabel(by.muscle)} : ${when}, ${where}`;   // texte brut : échappé à l'affichage
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

// Durée habituelle d'une séance (minutes, arrondies à 5) : médiane de ses 5 dernières,
// sinon estimation à 2,5 min par série prévue
function sessionMinutes(cat) {
  const p = data.activeProgramme;
  const durs = (data.history || [])
    .filter(h => h.category === cat && (h.programme || 'ppl') === p && h.duration > 5 * 60000)
    .slice(0, 5).map(h => h.duration).sort((a, b) => a - b);
  const ms = durs.length ? durs[Math.floor(durs.length / 2)]
    : (prog().exercises[cat] || []).reduce((a, ex) => a + (ex.sets || 0), 0) * 150_000;
  return ms ? Math.max(5, Math.round(ms / 300_000) * 5) : 0;
}

// Cible du jour d'un exercice, même règle que la puce de la séance (bumpReady) :
// toutes les séries de la dernière fois en haut de la fourchette → charge + 2,5 kg (5 lb) ;
// sinon la meilleure série de la dernière fois + 1 rep ; jamais fait → nombre de séries prévu.
function exerciseTarget(cat, ex) {
  const lp = lastPerf(data.activeProgramme, cat, ex);
  if (!lp) return { text: `${ex.sets} série${ex.sets > 1 ? 's' : ''}`, gain: '' };
  const sets = lp.ex.sets.filter(s => (parseInt(s.reps) || 0) > 0);
  const best = bestSet(sets);
  if (!best) return { text: `${ex.sets} série${ex.sets > 1 ? 's' : ''}`, gain: '' };
  const repMax = ex.repMax ?? 12;
  const bump = best.w > 0 && sets.length >= Math.min(ex.sets, 2) && sets.every(s => (parseInt(s.reps) || 0) >= repMax);
  if (bump) {
    return { text: `${fmtW(best.w + bumpStepKg())} ${unitLbl()}`, gain: bumpLabel() };
  }
  return { text: setTxt({ ...best, r: best.r + 1 }), gain: '+1 rep' };
}

// « À battre aujourd'hui » : les premiers exercices de la séance et leur cible
const HERO_TARGETS = 3;
function targetsCard(cat) {
  const exs = prog().exercises[cat] || [];
  if (!exs.length) return '';
  const rows = exs.slice(0, HERO_TARGETS).map(ex => {
    const t = exerciseTarget(cat, ex);
    return `<li class="targets__row"><span class="targets__name">${esc(ex.name)}</span>`
      + `<span class="targets__val num">${esc(t.text)}${t.gain ? `<span class="targets__gain">${esc(t.gain)}</span>` : ''}</span></li>`;
  }).join('');
  const more = exs.length - HERO_TARGETS;
  const anyHistory = exs.some(ex => lastPerf(data.activeProgramme, cat, ex));
  return `
    <section class="home-card targets" aria-label="${anyHistory ? 'À battre aujourd\'hui' : 'Au programme'}">
      <h2 class="home-card__title">${anyHistory ? 'À battre aujourd\'hui' : 'Au programme'}${more > 0 ? `<span class="home-card__aside">+ ${more} exercice${more > 1 ? 's' : ''}</span>` : ''}</h2>
      <ul class="targets__list">${rows}</ul>
    </section>`;
}

// Semaine en cours (lundi → dimanche) : séances par jour, volume ; et le volume moyen
// des 4 semaines précédentes, pour remplir l'anneau du volume
function weekStats() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const days = Array.from({ length: 7 }, () => []);
  let count = 0, volume = 0, before = 0;
  (data.history || []).forEach(h => {
    const v = sessionVolume(h.exercises);
    if (h.date >= monday) {
      const i = Math.floor((h.date - monday) / 86400000);
      if (i >= 0 && i < 7) { days[i].push(h); count++; volume += v; }
    } else if (h.date >= monday - 28 * 86400000) before += v;
  });
  return { days, count, volume, avgVolume: before / 4, today: (now.getDay() + 6) % 7 };
}

// Objectif de séances par semaine : réglé par l'utilisateur, sinon le nombre de séances du programme
function weeklyGoal() {
  return data.weeklyGoal || Math.min(7, Math.max(1, sessionKeys().length)) || 3;
}

// Anneau d'activité (52 px) : progress de 0 à 1, couleur pleine sur une piste de la même couleur
function activityRing(progress, color) {
  const r = 22, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, progress));
  return `<svg class="aring" width="52" height="52" viewBox="0 0 52 52" aria-hidden="true" style="--ring:${color}">
    <circle cx="26" cy="26" r="${r}" class="aring__track"/>
    <circle cx="26" cy="26" r="${r}" class="aring__fill" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"/>
  </svg>`;
}

function ringsRow(ws) {
  const goal = weeklyGoal(), streak = computeStreak();
  // Régularité : la semaine en cours compte dès 2 séances (computeStreak)
  const streakProgress = streak ? 1 : Math.min(1, ws.count / 2);
  const tile = (ring, value, label, aria) =>
    `<div class="rings__tile" role="img" aria-label="${esc(aria)}">${ring}<span class="rings__val num">${value}</span><span class="rings__lbl">${label}</span></div>`;
  return `
    <button class="rings" data-action="go-stats" aria-label="Voir les progrès">
      ${tile(activityRing(ws.count / goal, 'var(--red)'), `${ws.count}/${goal}`, 'séances', `${ws.count} séance${ws.count > 1 ? 's' : ''} sur ${goal} cette semaine`)}
      ${tile(activityRing(ws.avgVolume ? ws.volume / ws.avgVolume : (ws.volume ? 1 : 0), 'var(--green)'), fmtVolume(ws.volume), 'volume', `Volume de la semaine : ${fmtVolume(ws.volume)}`)}
      ${tile(activityRing(streakProgress, 'var(--orange)'), `${streak} sem.`, 'd\'affilée', `Régularité : ${streak} semaine${streak > 1 ? 's' : ''} d'affilée`)}
    </button>`;
}

const WEEK_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const WEEK_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
function weekCard(ws) {
  const cells = WEEK_DAYS.map((l, i) => {
    const h = ws.days[i][0];
    const today = i === ws.today;
    const label = `${WEEK_NAMES[i]}${today ? ', aujourd\'hui' : ''}${h ? ` : ${rawLabel(h.category, h.programme || 'ppl')}` : ''}`;
    const box = h
      ? `<span class="week__box week__box--done" style="--cat-color:${historyColor(h)}">${esc(rawLabel(h.category, h.programme || 'ppl').charAt(0).toUpperCase())}</span>`
      : `<span class="week__box${today ? ' week__box--today' : ''}"></span>`;
    return `<li class="week__day${today ? ' week__day--today' : ''}" aria-label="${esc(label)}"><span class="week__letter" aria-hidden="true">${l}</span>${box}</li>`;
  }).join('');
  return `
    <section class="home-card week" aria-label="Cette semaine">
      <h2 class="home-card__title">Cette semaine</h2>
      <ul class="week__days">${cells}</ul>
    </section>`;
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
    const nEx  = (prog().exercises[next] || []).length;
    const mins = sessionMinutes(next);
    let info, btn;
    if (liveHere) {
      info = `<div class="hero__info hero__info--live">En cours · <span class="num" id="hero-elapsed">${fmtClock(Date.now() - activeSession.startedAt)}</span></div>`;
      btn  = `<button class="hero__btn" data-action="resume-session">${icon('play', 18)}Reprendre</button>`;
    } else {
      info = last
        ? `<div class="hero__info">Dernière fois : ${fmtDate(last.date)} · ${fmtVolume(sessionVolume(last.exercises))}</div>`
        : `<div class="hero__info">Jamais faite</div>`;
      if (!st.ready) info += `<div class="hero__wait" id="hero-wait">Prochaine séance prête dans ${fmtWait(st.remaining)}</div>`;
      if (st.by) info += `<div class="hero__why">${esc(recoveryReason(st.by))}</div>`;
      btn = st.ready
        ? `<button class="hero__btn" data-action="start-session" data-cat="${esc(next)}" aria-label="Démarrer ${meta.label}">${icon('play', 18)}Démarrer</button>`
        : `<button class="hero__btn hero__btn--gray" data-action="start-session" data-cat="${esc(next)}">Démarrer quand même</button>`;
    }
    const chips = [nEx ? `${nEx} exercice${nEx > 1 ? 's' : ''}` : '', mins ? `≈ ${mins} min` : '']
      .filter(Boolean).map(c => `<span class="hero__chip num">${c}</span>`).join('');
    // Grand titre : la taille suit la longueur du nom (« PULL » comme « Bras & épaules »)
    const len = rawLabel(next).length;
    const size = len <= 5 ? 'xl' : len <= 9 ? 'l' : 'm';
    hero = `
      <section class="hero" aria-label="${liveHere ? 'Séance en cours' : 'Prochaine séance'}">
        <div class="hero__eyebrow">${liveHere ? 'Séance en cours' : 'Prochaine séance'}</div>
        <div class="hero__name hero__name--${size}">${isUserProg(data.activeProgramme) && meta.emoji ? `<span class="hero__emoji" aria-hidden="true">${meta.emoji}</span>` : ''}${meta.label}</div>
        ${meta.desc ? `<div class="hero__desc">${meta.desc}</div>` : ''}
        ${info}
        ${chips ? `<div class="hero__chips">${chips}</div>` : ''}
        ${btn}
        <button class="hero__link" data-action="go-editor" data-cat="${esc(next)}">Modifier les exercices</button>
      </section>
      ${liveHere ? '' : targetsCard(next)}`;
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

  const emptyCustom = isUserProg(data.activeProgramme) && keys.length === 0
    ? `<div class="empty-state">
         <div>Programme vide</div>
         <div class="empty-state__sub">Ajoute des séances dans l'onglet Programme</div>
       </div>`
    : '';

  const ws = weekStats();
  const color = next ? sessionMeta(next).color : 'var(--tint)';
  const date = fmtDate(Date.now(), 'day');
  const right = `<button class="navbar__icon" data-action="go-settings" aria-label="Réglages">${icon('gear', 24)}</button>`;
  const sub = `<button class="navbar__sub" data-action="go-programmes" aria-label="Programme ${esc(pm.name)}, changer de programme">Programme ${esc(pm.name)} ${icon('chevron.right', 12)}</button>`;

  return `
    <div class="view dashboard" style="--cat-color:${color}">
      <div class="dashboard__glow" aria-hidden="true"></div>
      ${navBar({ title: 'Entraînement', largeTitle: date, right, sub })}
      <div class="home">
        ${hero || emptyCustom}
        ${keys.length ? ringsRow(ws) + weekCard(ws) : ''}
        ${others ? `<section class="home-card home-card--list" aria-label="Autres séances"><h2 class="home-card__title">Autres séances</h2>${others}</section>` : ''}
      </div>
    </div>`;
}

// Feuille d'actions d'une séance de l'accueil
async function sessionActions(cat) {
  const st = catStatus(cat);
  const choice = await dialog({ type: 'sheet', title: rawLabel(cat),
    ...(st.by ? { message: `Muscles encore en récupération. ${recoveryReason(st.by)}` } : {}), actions: [
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
