// ═══════════════════════════════════════════════════════════
//  Entraînement (accueil) : prochaine séance, récupération, chronos
// ═══════════════════════════════════════════════════════════
'use strict';

let ticker = null;

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
  const remaining = last ? readyAt - now : 0;
  return { last, readyAt, remaining, ready: remaining <= 0, by: remaining > 0 ? best.by : null };
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
    : `<span class="home-cell__status">dans ${fmtWait(st.remaining)}</span>`;
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

// Cible du jour d'un exercice : exerciseTarget (js/data/goals.js), la même qu'en séance.

// « À battre aujourd'hui », dans la carte de la prochaine séance : les premiers exercices, la cible en
// gras, le gain avec une flèche ↑ (jamais la couleur seule : « ↑ 1 rep », sans « + »), la dernière fois
// en gris dessous. Jamais fait : « Au programme » et le nombre de séries prévu.
const HERO_TARGETS = 3;
function targetRowHtml(cat, ex) {
  const t = exerciseTarget(cat, ex);
  const gain = t.gain
    ? `<span class="targets__gain num">${icon('arrow.up', 11)}${esc(t.gain)}<span class="sr-text"> de plus</span></span>` : '';
  const before = t.gain && t.before ? `<span class="targets__before num">avant ${esc(t.before)}</span>` : '';
  return `<li class="targets__row"><span class="targets__name">${esc(ex.name)}</span>`
    + `<span class="targets__val"><span class="targets__now"><span class="targets__target num">${esc(t.text)}</span>${gain}</span>${before}</span></li>`;
}
function targetsHtml(cat) {
  const exs = prog().exercises[cat] || [];
  if (!exs.length) return '';
  const more = exs.length - HERO_TARGETS;
  const anyHistory = exs.some(ex => lastPerf(data.activeProgramme, cat, ex));
  return `
    <div class="targets">
      <div class="targets__head">
        <h3 class="targets__title">${anyHistory ? 'À battre aujourd\'hui' : 'Au programme'}</h3>
        <button class="targets__edit" data-action="go-editor" data-cat="${esc(cat)}" aria-label="Modifier les exercices">Modifier</button>
      </div>
      <ul class="targets__list">${exs.slice(0, HERO_TARGETS).map(ex => targetRowHtml(cat, ex)).join('')}</ul>
      ${more > 0 ? `<p class="targets__more">et ${plural(more, 'autre exercice', 'autres exercices')}</p>` : ''}
    </div>`;
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

// Cette semaine, en une carte : le compte face à l'objectif (« 2 sur 3 »), une pastille par jour, puis
// les séances du mois et de l'année en une ligne. Toute la carte mène aux progrès.
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
// Pastille d'un jour : faite = pleine en accent avec une coche (le sens ne tient jamais à la couleur
// seule), aujourd'hui = contour en accent, les autres jours = neutres
function weekDayHtml(letter, done, today) {
  const cls = `week__dot${done ? ' week__dot--done' : ''}${today ? ' week__dot--today' : ''}`;
  return `<span class="week__day${today ? ' week__day--today' : ''}"><span class="week__letter">${letter}</span>`
    + `<span class="${cls}">${done ? icon('checkmark', 14) : ''}</span></span>`;
}
function weekCard(ws) {
  const goal = weeklyGoal();
  const days = WEEK_DAYS.map((l, i) => weekDayHtml(l, !!ws.days[i][0], i === ws.today)).join('');
  const done = ws.days.map((d, i) => d[0] ? `${WEEK_NAMES[i]} ${rawLabel(d[0].category, entryProg(d[0]))}` : '').filter(Boolean);
  const line = weekLine();
  // Intitulé VoiceOver = le titre affiché suivi du détail (texte masqué) : pas d'aria-label qui ne
  // reprendrait pas « Cette semaine » (WCAG 2.5.3, le nom doit contenir le texte visible)
  const spoken = ` : ${ws.count} séance${ws.count > 1 ? 's' : ''} sur ${goal}${done.length ? ` (${done.join(', ')})` : ''}.${line ? ` ${line.replace(/ · /g, ', ')}.` : ''}`;
  return `
    <button class="home-card week" data-action="go-stats" aria-description="Voir les progrès">
      <span class="week__head"><span class="home-card__title">Cette semaine</span><span class="sr-text">${esc(spoken)}</span><span class="week__count num" aria-hidden="true"><b>${ws.count}</b> sur ${goal}</span></span>
      <span class="week__days" aria-hidden="true">${days}</span>
      ${line ? `<span class="week__line" aria-hidden="true"><span class="week__text">${esc(line)}</span>${icon('chevron.right', 12)}</span>` : ''}
    </button>`;
}

// Infos de la carte : « 5 exercices · ≈ 60 min », puis « Dernière fois : ven. 30 oct. » sur sa propre ligne
// (sur une seule, elle passait à la ligne au milieu, même sur un grand iPhone)
function heroFactsHtml(cat, last) {
  const nEx = (prog().exercises[cat] || []).length, mins = sessionMinutes(cat);
  const facts = [nEx ? plural(nEx, 'exercice', 'exercices') : '', mins ? `≈ ${mins} min` : ''].filter(Boolean).join(' · ');
  const when = last ? `Dernière fois : ${fmtDate(last.date)}` : 'Jamais faite';
  return `<p class="hero__info num">${facts ? `<span class="hero__fact">${facts}</span>` : ''}<span class="hero__fact">${when}</span></p>`;
}

// Prochaine séance (ou séance en cours) : une seule carte, avec Démarrer comme seul bouton plein.
// Pas prête : l'attente, ce qui la fixe et « Démarrer quand même » en gris.
function heroHtml(keys, next, liveHere) {
  const meta = sessionMeta(next), st = catStatus(next);
  let info, btn;
  if (liveHere) {
    info = `<p class="hero__info hero__info--live">En cours · <span class="num" id="hero-elapsed">${fmtClock(Date.now() - activeSession.startedAt)}</span></p>`;
    btn  = `<button class="hero__btn" data-action="resume-session">${icon('play', 18)}Reprendre</button>`;
  } else {
    info = heroFactsHtml(next, lastEntryOf(next));
    if (!st.ready) info += `<p class="hero__wait" id="hero-wait">Prochaine séance prête dans ${fmtWait(st.remaining)}</p>`;
    if (st.by) info += `<p class="hero__why">${esc(recoveryReason(st.by))}</p>`;
    info += sleepHomeHtml();   // Santé : la nuit, une ligne (js/features/apple-services.js)
    const passed = passedOverNote(keys, next);
    if (passed) info += `<p class="hero__why hero__why--passed">${esc(passed)}</p>`;
    btn = st.ready
      ? `<button class="hero__btn" data-action="start-session" data-cat="${esc(next)}" aria-label="Démarrer ${meta.label}">${icon('play', 18)}Démarrer</button>`
      : `<button class="hero__btn hero__btn--gray" data-action="start-session" data-cat="${esc(next)}">Démarrer quand même</button>`;
  }
  const desc = meta.desc || coachSessionDesc(data.activeProgramme, next);
  // « Modifier les exercices » vit dans l'en-tête des cibles ; sans cibles (séance en cours, séance
  // vide), un lien sous le bouton le remplace, comme avant la refonte
  const targets = liveHere ? '' : targetsHtml(next);
  const edit = targets ? '' : `<button class="hero__edit" data-action="go-editor" data-cat="${esc(next)}">Modifier les exercices</button>`;
  const spot = heroBtnSpot();
  // Grand titre : plus petit pour un nom long (« Bras & épaules »)
  const size = rawLabel(next).length <= 9 ? 'l' : 'm';
  return `
    <section class="hero" aria-label="${liveHere ? 'Séance en cours' : 'Prochaine séance'}">
      <p class="hero__eyebrow">${liveHere ? 'Séance en cours' : 'Prochaine séance'}</p>
      <h2 class="hero__name hero__name--${size}">${meta.label}</h2>
      ${spot === 'top' ? btn : ''}
      ${desc ? `<p class="hero__desc">${desc}</p>` : ''}
      ${info}
      ${spot === 'mid' ? btn : ''}${targets}
      ${edit}
    </section>`;
}

// Place de Démarrer dans la carte. Ordre de lecture = ordre affiché (WCAG 1.3.2) : c'est le HTML qui la
// fixe, jamais CSS order (VoiceOver suit le DOM). Choix refait au rendu (checkTypeSize de js/ui/theme.js) :
//   'mid' : partout, avant « À battre aujourd'hui » : le bouton est au même endroit sur tous les iPhone, en
//           sombre comme en clair (vote de la direction sobre : il passait sous les cibles sur un grand écran
//           et au-dessus sur un petit), et toujours visible sans défiler ;
//   'top' : très grands caractères (type-xl), juste sous le nom : la description, les infos et l'attente
//           remplissent déjà l'écran, Démarrer resterait sous la tab bar.
function heroBtnSpot() {
  return document.documentElement.classList.contains('type-xl') ? 'top' : 'mid';
}

// « Ensuite » : les autres séances du programme, sans couleur de séance, leur état à droite
function otherSessionHtml(cat) {
  const n = (prog().exercises[cat] || []).length;
  return `
      <button class="home-cell" data-action="session-actions" data-cat="${esc(cat)}">
        <span class="home-cell__text"><span class="home-cell__name">${sessionMeta(cat).label}</span><span class="home-cell__sub num">${plural(n, 'exercice', 'exercices')}</span></span>
        <span class="home-cell__right" data-status-cat="${esc(cat)}">${cellStatusHtml(cat)}</span>
        ${icon('chevron.right', 14)}
      </button>`;
}


// Libellé suivi du chevron : le dernier mot et le chevron ne se séparent jamais (chevron seul sur sa ligne en AX33, panel t6)
function navSubWithChevron(text) {
  const i = text.lastIndexOf(' ');
  return `${esc(text.slice(0, i + 1))}<span class="navbar__sub-end">${esc(text.slice(i + 1))}\u00a0${icon('chevron.right', 12)}</span>`;
}

function renderDashboard() {
  const keys = sessionKeys();
  const pm   = progMeta();
  const liveHere = activeSession && activeSession.programme === data.activeProgramme && keys.includes(activeSession.category);
  const next = liveHere ? activeSession.category : nextSessionCat(keys);

  const hero = next ? `${heroHtml(keys, next, liveHere)}${recapHomeCard()}${accountHomeCard()}${coachHomeCard()}` : '';
  const others = keys.filter(k => k !== next).map(otherSessionHtml).join('');

  const emptyCustom = isUserProg(data.activeProgramme) && keys.length === 0
    ? `<div class="empty-state">
         <div>Programme vide</div>
         <div class="empty-state__sub">Ajoute des séances dans l'onglet Programme</div>
       </div>`
    : '';

  const date = fmtDate(Date.now(), 'day');
  const right = settingsButtonHtml();
  const from = coachFromLine(data.activeProgramme);   // programme reçu d'un coach (js/features/coach-ui.js)
  const sub = `<button class="navbar__sub" data-action="go-my-programmes" aria-label="Programme ${esc(pm.name)}${from ? `, ${from}` : ''}, mes programmes">${navSubWithChevron(`Programme ${pm.name}`)}</button>${from ? `<p class="coach-from coach-from--home">${from}</p>` : ''}`;

  return `
    <div class="view dashboard">
      ${navBar({ title: 'Entraînement', largeTitle: date, right, sub })}
      <div class="home">
        ${accessBannerHtml()}
        ${hero || emptyCustom}
        ${hero ? '' : accountHomeCard()}
        ${hero ? '' : recapHomeCard()}
        ${nutritionHomeCard()}
        ${keys.length ? weekCard(weekStats()) : ''}
        ${others ? `<section class="home-list" aria-labelledby="homeNext"><h2 class="home-list__title" id="homeNext">Ensuite</h2><div class="home-card">${others}</div></section>` : ''}
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
  // Mode lecture seule (verrou allumé, plus le droit d'écrire) : l'abonnement est proposé, rien n'est touché
  if (!(await accessGate())) return;
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
