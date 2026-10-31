// ═══════════════════════════════════════════════════════════
//  Entraînement (accueil) : prochaine séance, récupération, chronos
// ═══════════════════════════════════════════════════════════
'use strict';

let ticker = null;

// Pastille de séance : point de la couleur de la séance
function catDot(cat, progId) {
  return catBadge(sessionMeta(cat, progId || data.activeProgramme).color);
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
// Le cardio fatigue moins qu'une séance de force : un muscle travaillé en cardio (course, vélo, saisi
// ou lu dans Santé) est prêt au bout de CARDIO_RECOVERY_H heures au plus, pas du délai de la séance.
// Ce qui attend le plus longtemps l'emporte : la séance elle-même, ou l'un de ses muscles.
// last : date de ce qui fixe le délai ; readyAt : heure à laquelle la séance sera prête (0 si elle
// l'est depuis toujours) ; by : { muscle, entry } qui fixe le délai quand il vient d'ailleurs que
// cette séance, sinon null.
const CARDIO_RECOVERY_H = 24;
function catStatus(cat, now = Date.now()) {
  const p = prog();
  const cd = getCooldown(cat) * 3600_000, skipped = p.skipped?.[cat] ?? -Infinity;
  const own = p.timers[cat] || null;
  let best = own && own > skipped ? { date: own, readyAt: own + cd, by: null } : null;
  const rec = sessionRecovery(cat, { cd, after: skipped });
  if (rec && rec.readyAt > (best?.readyAt || 0)) {
    const e = rec.entry, mine = e.category === cat && entryProg(e) === data.activeProgramme;
    best = { date: rec.date, readyAt: rec.readyAt, by: mine ? null : rec };
  }
  const last = best?.date ?? null, readyAt = best?.readyAt || 0;
  const remaining = last ? readyAt - now : 0, span = readyAt - last;
  return { last, readyAt, remaining, ready: remaining <= 0, progress: last && span > 0 ? Math.min(1, 1 - remaining / span) : 1,
    by: remaining > 0 ? best.by : null };
}

// Dernier entraînement (muscle principal, au moins une série) de chaque muscle, sur tout l'historique
// et les courses et sorties vélo lues dans Santé (quadriceps, mollets : la séance jambes attend), à part
// pour la force et le cardio (récupération plus courte) : Map muscle → { force?, cardio? }, chacun
// { date, entry }. Une sortie de Santé trop courte (trajet détecté par la montre) ne compte pas
// (healthCountsForRecovery) ; elle reste affichée dans l'Historique.
// Gardé tant que l'historique, Santé et les muscles déclarés ne changent pas (l'accueil le lit pour chaque séance).
let muscleLastCache = { key: null, map: null };
function muscleLastWorked() {
  const h = data.history || [], fromHealth = healthEntries().filter(healthCountsForRecovery);
  const key = `${h.length}:${h[0]?.id}:${h[0]?.date}:${fromHealth.length}:${fromHealth[0]?.id}:${JSON.stringify(data.exerciseMuscles || {})}:${JSON.stringify([...chosenMusclesIndex()])}`;
  if (muscleLastCache.key === key) return muscleLastCache.map;
  const map = new Map(), index = chosenMusclesIndex();
  [...h, ...fromHealth].forEach(entry => (entry.exercises || []).forEach(e => {
    if (!(e.sets || []).some(s => (parseInt(s?.reps) || 0) > 0)) return;
    const kind = measureOf(e) === 'cardio' ? 'cardio' : 'force';
    exerciseMuscles(e, index).primary.forEach(m => {
      const w = map.get(m) || {};
      if (!(w[kind]?.date >= entry.date)) { w[kind] = { date: entry.date, entry }; map.set(m, w); }
    });
  }));
  muscleLastCache = { key, map };
  return map;
}

// Muscle principal de la séance qui la fait attendre le plus longtemps : { muscle, date, entry, readyAt }
// ou null. cd : délai de la séance (ms) ; after : le travail jusqu'à cette heure est ignoré (délai passé)
function sessionRecovery(cat, { cd = getCooldown(cat) * 3600_000, after = -Infinity } = {}) {
  const index = chosenMusclesIndex();
  const muscles = new Set((prog().exercises[cat] || []).flatMap(ex => exerciseMuscles(ex, index).primary));
  if (!muscles.size) return null;
  const last = muscleLastWorked(), wait = { force: cd, cardio: Math.min(cd, CARDIO_RECOVERY_H * 3600_000) };
  let best = null;
  muscles.forEach(m => Object.entries(last.get(m) || {}).forEach(([kind, w]) => {
    if (w.date <= after) return;
    const readyAt = w.date + wait[kind];
    if (!best || readyAt > best.readyAt || (readyAt === best.readyAt && w.date > best.date)) best = { muscle: m, ...w, readyAt };
  }));
  return best;
}

// « Biceps : hier, Bras & épaules », « Quadriceps : aujourd'hui, Course (Apple Watch) » :
// pourquoi une séance attend à cause d'une autre
function recoveryReason(by) {
  const e = by.entry, pid = entryProg(e);
  const where = isHealthEntry(e) ? `${e.health.title} (${e.health.source})`
    : pid === FREE ? 'séance libre'
    : pid === data.activeProgramme ? rawLabel(e.category, pid) : progMeta(pid).name;
  const days = daysAgo(e.date);
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

// Prochaine séance : la séance prête dont les muscles se reposent depuis le plus longtemps (ou jamais
// faite), sinon celle qui sera prête la première. À égalité, la séance faite il y a le plus longtemps :
// juste après Haut du corps, Bas du corps (bloquée par les abdos du même entraînement) passe devant
// la séance qu'on vient de finir. Une seule heure de référence : le tri reste cohérent.
function nextSessionCat(keys) {
  if (!keys.length) return null;
  const now = Date.now(), st = new Map(keys.map(k => [k, catStatus(k, now)]));
  const own = k => prog().timers[k] || 0;
  const ready = keys.filter(k => st.get(k).ready);
  if (ready.length) return ready.sort((a, b) => (st.get(a).last || 0) - (st.get(b).last || 0) || own(a) - own(b))[0];
  return keys.slice().sort((a, b) => st.get(a).readyAt - st.get(b).readyAt || own(a) - own(b))[0];
}

// Séance qu'attendait la rotation (jamais faite, sinon faite il y a le plus longtemps) quand
// l'accueil en propose une autre à cause de la récupération des muscles : texte brut, sinon ''.
//   « Push attend : quadriceps en récupération (encore 1 j) »  (pas prête)
//   « Push passe après (quadriceps : il y a 4 jours, Legs) »   (prête, mais muscles moins reposés)
function passedOverNote(keys, next) {
  const own = k => prog().timers[k] || 0;
  const expected = keys.slice().sort((a, b) => own(a) - own(b))[0];
  if (!expected || !next || expected === next) return '';
  const label = rawLabel(expected), st = catStatus(expected);
  if (!st.ready) {
    const why = st.by ? `${lowerFirst(muscleLabel(st.by.muscle))} en récupération` : 'récupération';
    return `${label} attend : ${why} (encore ${fmtWait(st.remaining)})`;
  }
  const rec = sessionRecovery(expected);
  return rec && rec.date > own(expected) ? `${label} passe après (${lowerFirst(recoveryReason(rec))})` : '';
}
function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

function lastEntryOf(cat) {
  const p = data.activeProgramme;
  return (data.history || []).find(h => h.category === cat && entryProg(h) === p) || null;
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
    .filter(h => h.category === cat && entryProg(h) === p && h.duration > 5 * 60000)
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
  const sets = workSets(lp.ex.sets).filter(s => (parseInt(s.reps) || 0) > 0);   // l'échauffement ne fixe pas la cible
  const best = bestSet(sets);
  if (!best) return { text: `${ex.sets} série${ex.sets > 1 ? 's' : ''}`, gain: '' };
  const m = measureOf(ex);
  if (m !== 'reps' || isAssisted(ex)) return { text: setTxt(best, ex), gain: '' };
  if (loadKind(ex) === 'lest') return { text: setTxt({ ...best, r: best.r + 1, reps: String(best.r + 1) }, ex), gain: '+1 rep' };   // durée, cardio : on rappelle la dernière fois
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
      <h2 class="home-card__title">${anyHistory ? 'À battre aujourd\'hui' : 'Au programme'}${more > 0 ? `<span class="home-card__aside">+ ${more}<span class="home-card__aside-more"> exercice${more > 1 ? 's' : ''}</span></span>` : ''}</h2>
      <ul class="targets__list">${rows}</ul>
    </section>`;
}

// Semaine en cours (lundi → dimanche) : séances par jour, nombre
function weekStats(now = Date.now()) {
  const monday = weekStart(now), next = addDays(monday, 7);
  const days = Array.from({ length: 7 }, () => []);
  let count = 0;
  (data.history || []).forEach(h => {
    if (h.date < monday || h.date >= next) return;
    days[dayIndexInWeek(h.date)].push(h); count++;
  });
  return { days, count, today: dayIndexInWeek(now) };
}

// Objectif de séances par semaine : réglé par l'utilisateur, sinon le nombre de séances du programme
function weeklyGoal() {
  return data.weeklyGoal || Math.min(7, Math.max(1, sessionKeys().length)) || 3;
}

// Cette semaine, en une carte : l'anneau des séances face à l'objectif, une pastille par jour (couleur
// de la séance faite), puis les séances du mois et de l'année en une ligne. Toute la carte mène aux
// progrès.
const WEEK_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const WEEK_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
// Des cumuls, jamais décourageants : « 9 séances ce mois · 87 cette année ». En janvier, l'année
// répéterait le mois : elle est omise. Le volume de la semaine n'y est plus : la ligne passait sur deux
// lignes, même sur iPhone 13 (« 13 séances ce mois · 130 cette année · 12,4 t soulevées »).
function weekLine(totals = historyTotals()) {
  const { month, year } = totals;
  const parts = [];
  if (month) parts.push(`${plural(month, 'séance', 'séances')} ce mois`);
  if (year > month) parts.push(month ? `${year} cette année` : `${plural(year, 'séance', 'séances')} cette année`);
  return parts.join(' · ');
}
// Anneau des séances de la semaine (52 px, comme l'anneau Bouger d'Apple) : le compte au centre
function weekRing(count, goal) {
  const r = 22, c = 2 * Math.PI * r, p = Math.min(1, count / goal);
  return `<span class="week__ring"><svg class="aring" width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
    <circle cx="26" cy="26" r="${r}" class="aring__track"/>
    <circle cx="26" cy="26" r="${r}" class="aring__fill" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"/>
  </svg><span class="week__ring-val num">${count}/${goal}</span></span>`;
}
function weekCard(ws) {
  const goal = weeklyGoal();
  const days = WEEK_DAYS.map((l, i) => {
    const h = ws.days[i][0], today = i === ws.today;
    const dot = h ? ` week__dot--done" style="--cat-color:${historyColor(h)}` : today ? ' week__dot--today' : '';
    return `<span class="week__day${today ? ' week__day--today' : ''}"><span class="week__letter">${l}</span><span class="week__dot${dot}"></span></span>`;
  }).join('');
  const done = ws.days.map((d, i) => d[0] ? `${WEEK_NAMES[i]} ${rawLabel(d[0].category, entryProg(d[0]))}` : '').filter(Boolean);
  const line = weekLine();
  const aria = `Cette semaine : ${ws.count} séance${ws.count > 1 ? 's' : ''} sur ${goal}${done.length ? ` (${done.join(', ')})` : ''}.${line ? ` ${line.replace(/ · /g, ', ')}.` : ''}`;
  return `
    <button class="home-card week" data-action="go-stats" aria-label="${esc(aria)}" aria-description="Voir les progrès">
      <span class="home-card__title" aria-hidden="true">Cette semaine</span>
      <span class="week__body" aria-hidden="true">${weekRing(ws.count, goal)}<span class="week__days">${days}</span></span>
      ${line ? `<span class="week__line" aria-hidden="true">${esc(line)}${icon('chevron.right', 12)}</span>` : ''}
    </button>`;
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
        ? `<div class="hero__info">Dernière fois : ${fmtDate(last.date)} · ${fmtVolume(sessionVolume(last.exercises, entryBodyKg(last)))}</div>`
        : `<div class="hero__info">Jamais faite</div>`;
      if (!st.ready) info += `<div class="hero__wait" id="hero-wait">Prochaine séance prête dans ${fmtWait(st.remaining)}</div>`;
      if (st.by) info += `<div class="hero__why">${esc(recoveryReason(st.by))}</div>`;
      info += sleepHomeHtml();   // Santé : la nuit, une ligne (js/features/apple-services.js)
      const passed = passedOverNote(keys, next);
      if (passed) info += `<div class="hero__why hero__why--passed">${esc(passed)}</div>`;
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
        <div class="hero__name hero__name--${size}">${meta.label}</div>
        ${meta.desc || coachSessionDesc(data.activeProgramme, next) ? `<div class="hero__desc">${meta.desc || coachSessionDesc(data.activeProgramme, next)}</div>` : ''}
        ${info}
        ${chips ? `<div class="hero__chips">${chips}</div>` : ''}
        ${btn}
        <button class="hero__link" data-action="go-editor" data-cat="${esc(next)}">Modifier les exercices</button>
      </section>
      ${accountHomeCard()}
      ${coachHomeCard()}
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
  // Connecté : l'avatar remplace la roue (comme l'App Store) ; il mène aux Réglages, Compte en tête
  const right = account.user
    ? `<button class="navbar__icon navbar__avatar" data-action="go-settings" aria-label="Compte et réglages">${avatarHtml('s')}</button>`
    : `<button class="navbar__icon" data-action="go-settings" aria-label="Réglages">${icon('gear', 24)}</button>`;
  const from = coachFromLine(data.activeProgramme);   // programme reçu d'un coach (js/features/coach-ui.js)
  const sub = `<button class="navbar__sub" data-action="go-my-programmes" aria-label="Programme ${esc(pm.name)}${from ? `, ${from}` : ''}, mes programmes">Programme ${esc(pm.name)} ${icon('chevron.right', 12)}</button>${from ? `<p class="coach-from coach-from--home">${from}</p>` : ''}`;

  return `
    <div class="view dashboard" style="--cat-color:${color}">
      ${navBar({ title: 'Entraînement', largeTitle: date, right, sub })}
      <div class="home">
        ${hero || emptyCustom}
        ${hero ? '' : accountHomeCard()}
        ${recapHomeCard()}
        ${keys.length ? weekCard(ws) : ''}
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
  playMelody('tick');
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
