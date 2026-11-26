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
// Le tronc (abdominaux, obliques) ne bloque pas une séance qui travaille aussi autre chose : un gainage ou un dead bug
// en fin de séance ne doit pas retenir Dos, Épaules et Bras pendant trois jours (retour de Maxence, 19/11 : Jambes finie
// par une planche, l'accueil lui reproposait Pecs). Une séance d'abdos seule attend toujours ses abdos.
// Un exercice de tronc l'est en entier : la planche latérale (obliques et fessiers principaux depuis l'audit des
// sous-muscles du 20/11) ne retient pas Épaules à cause des fessiers de Jambes.
const CORE_MUSCLES = new Set(['abs', 'obliques']);
function sessionBlockingMuscles(cat) {
  const index = chosenMusclesIndex();
  const lists = (prog().exercises[cat] || []).map(ex => exerciseMuscles(ex, index).primary);
  const all = new Set(lists.flat());
  const main = new Set(lists.filter(p => !p.some(m => CORE_MUSCLES.has(m))).flat());
  return main.size ? main : all;
}
function sessionRecovery(cat, { cd = getCooldown(cat) * 3600_000, after = -Infinity } = {}) {
  const muscles = sessionBlockingMuscles(cat);
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
  if (isUserProg(data.activeProgramme)) return sessionQueue(keys)[0];
  const now = Date.now(), st = new Map(keys.map(k => [k, catStatus(k, now)]));
  const own = k => prog().timers[k] || 0;
  const ready = keys.filter(k => st.get(k).ready);
  if (ready.length) return ready.sort((a, b) => (st.get(a).last || 0) - (st.get(b).last || 0) || own(a) - own(b))[0];
  return keys.slice().sort((a, b) => st.get(a).readyAt - st.get(b).readyAt || own(a) - own(b))[0];
}

// File des séances d'un programme créé (règle de Maxence, 19/11 : « l'ordre du programme doit toujours être le même
// dans l'affichage, et si on fait une séance, il faut que ça mette à jour la file, c'est tout ») : faire une séance la
// renvoie en fin de file. Reconstituée depuis la dernière date de chaque séance (chronos du programme, rien de stocké) :
// jamais faites d'abord, dans l'ordre du programme, puis de la plus ancienne à la plus récente. La séance proposée est
// la tête de file ; la récupération n'est qu'un avertissement sur sa carte, elle ne change jamais la file.
// Programmes intégrés : selon la récupération (nextSessionCat, sessionsByReadiness), comme avant.
// Ordre changé (orderAt, posé par moveSession ou par une mise à jour du coach) : les séances faites avant comptent comme
// jamais faites, la file reprend l'ordre choisi ; celles faites depuis repartent à la fin, comme d'habitude.
function sessionOrderAt(pid = data.activeProgramme) {
  return data.userProgrammes?.[pid]?.orderAt || data.programmes[pid]?.orderAt || 0;
}
function sessionQueue(keys) {
  const at = sessionOrderAt();
  const t = k => { const d = prog().timers[k] || 0; return d < at ? 0 : d; };
  return keys.map((k, i) => [k, i]).sort((a, b) => t(a[0]) - t(b[0]) || a[1] - b[1]).map(([k]) => k);
}
// Les autres séances de l'accueil, sans la proposée (ou celle en cours) : la file, ou selon la récupération
function otherSessions(keys, next) {
  const rest = keys.filter(k => k !== next);
  return isUserProg(data.activeProgramme) ? sessionQueue(rest) : sessionsByReadiness(rest);
}

// « Autres séances » dans l'ordre des chronos (retour de Maxence, 15/11) : d'abord les prêtes (la moins récente
// en tête, comme nextSessionCat), puis les autres de la plus proche à la plus lointaine
function sessionsByReadiness(keys) {
  const now = Date.now(), st = new Map(keys.map(k => [k, catStatus(k, now)]));
  const own = k => prog().timers[k] || 0;
  return keys.slice().sort((a, b) => {
    const A = st.get(a), B = st.get(b);
    if (A.ready !== B.ready) return A.ready ? -1 : 1;
    return A.ready ? ((A.last || 0) - (B.last || 0) || own(a) - own(b)) : (A.readyAt - B.readyAt || own(a) - own(b));
  });
}

// Séance qu'attendait la rotation (jamais faite, sinon faite il y a le plus longtemps) quand
// l'accueil en propose une autre à cause de la récupération des muscles : texte brut, sinon ''.
//   « Push attend : quadriceps en récupération (encore 1 j) »  (pas prête)
//   « Push passe après (quadriceps : il y a 4 jours, Legs) »   (prête, mais muscles moins reposés)
function passedOverNote(keys, next) {
  if (isUserProg(data.activeProgramme)) return '';   // programme créé : la file, rien n'est sauté
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
// « Attention : il reste 1 j 18 h de récupération (quadriceps) » : une phrase sans accord à faire avec le muscle
// (« Grand dorsal », « Épaules antérieures ») ; sans muscle connu, le délai de la séance elle-même
function recoveryWarning(st) {
  const what = st.by ? ` (${lowerFirst(muscleLabel(st.by.muscle))})` : '';
  return `Attention : il reste ${fmtWait(st.remaining)} de récupération${what}`;
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
    : `<span class="home-cell__status">Prête dans ${fmtWait(st.remaining)}${st.by ? ` (${esc(lowerFirst(muscleLabel(st.by.muscle)))})` : ''}</span>`;   // le muscle qui attend, comme sur la carte
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

// « À battre aujourd'hui », dans la carte de la prochaine séance : tous les exercices en lignes compactes (plus de
// « et 2 autres exercices » : « c'est chiant de pas tout voir », Maxence le 23/11 ; Démarrer est au-dessus, la liste
// ne le repousse jamais, heroBtnSpot). Le nom à
// gauche (deux lignes au plus, puis « … » ; VoiceOver le lit en entier), la cible en gras à droite ; dessous, en gris,
// la dernière fois (« avant … ») et le gain avec une flèche ↑ (jamais la couleur seule : « ↑ 1 rep », sans « + »).
// Jamais fait : « Au programme » et la cible seule.
// Bloc de pré-fatigue ou d'échauffement (js/data/blocks.js) : rien à battre, son rôle seul sous le nom
function targetRowHtml(cat, ex, xs = [ex]) {
  const name = blockName(ex, xs);
  if (blockRole(ex)) return `<li class="targets__row"><span class="targets__main"><span class="targets__name">${esc(name)}</span></span><span class="targets__sub"><span class="targets__before">${blockRoleLabel(ex)}</span></span></li>`;
  const t = exerciseTarget(cat, ex);
  const gain = t.gain
    ? `<span class="targets__gain num">${icon('arrow.up', 11)}${esc(t.gain)}<span class="sr-text"> de plus</span></span>` : '';
  const before = t.gain && t.before ? `<span class="targets__before num">avant ${esc(t.before)}</span>` : '';
  return `<li class="targets__row"><span class="targets__main"><span class="targets__name">${esc(name)}</span>`
    // Charge prescrite par le coach : « Coach : 60 kg × 8 », comme en séance
    + `<span class="targets__target num">${t.coach ? `<span aria-hidden="true">Coach : ${esc(t.text)}</span><span class="visually-hidden">Prescrit par ${myCoachWord('ton')} : ${esc(t.spoken)}</span>` : esc(t.text)}</span></span>`
    + `${before || gain ? `<span class="targets__sub">${before}${gain}</span>` : ''}</li>`;
}
function targetsHtml(cat) {
  const exs = prog().exercises[cat] || [];
  if (!exs.length) return '';
  const anyHistory = exs.some(ex => lastPerf(data.activeProgramme, cat, ex));
  return `
    <div class="targets">
      <div class="targets__head">
        <h3 class="targets__title">${anyHistory ? 'À battre aujourd\'hui' : 'Au programme'}</h3>
        <button class="targets__edit" data-action="go-editor" data-cat="${esc(cat)}" aria-label="Modifier la séance : ses exercices et ses objectifs">Modifier la séance</button>
      </div>
      <ul class="targets__list">${exs.map(ex => targetRowHtml(cat, ex, exs)).join('')}</ul>
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

// Objectif de séances par semaine : weeklyGoal (js/data/goals.js)

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
  // Date d'un bloc (espaces insécables) : jamais « ven. » en fin de ligne et « 30 oct. » dessous (iPhone SE)
  const when = last ? `Dernière fois : ${fmtDate(last.date).replace(/ /g, '\u00a0')}` : 'Jamais faite';
  return `<p class="hero__info num">${facts ? `<span class="hero__fact">${facts}</span>` : ''}<span class="hero__fact">${when}</span></p>`;
}

// Prochaine séance (ou séance en cours) : une carte illustrée, comme les groupes de la Bibliothèque, avec Démarrer comme
// seul bouton plein. Pas prête : l'attente, ce qui la fixe et « Démarrer quand même » en gris.
function heroParts(keys, next, liveHere) {
  const meta = sessionMeta(next), st = catStatus(next);
  let facts, more = '', btn, warn = '';
  if (liveHere) {
    facts = `<p class="hero__info hero__info--live">En cours · <span class="num" id="hero-elapsed">${fmtClock(Date.now() - activeSession.startedAt)}</span></p>`;
    btn  = `<button class="hero__btn" data-action="resume-session">${icon('play', 18)}Reprendre</button>`;
  } else {
    facts = heroFactsHtml(next, lastEntryOf(next));
    // Programme créé : la file décide, la récupération n'est qu'un avertissement, Démarrer reste le bouton plein
    const queue = isUserProg(data.activeProgramme);
    // L'avertissement est relié à Démarrer (aria-describedby) et toujours au-dessus de lui, texte agrandi compris (heroHtml)
    if (!st.ready && queue) warn = `<p class="hero__wait" id="hero-warn">${esc(recoveryWarning(st))}</p>`;
    else if (!st.ready) more += `<p class="hero__wait" id="hero-wait">Prochaine séance prête dans ${fmtWait(st.remaining)}</p>`;
    if (st.by) more += `<p class="hero__why">${esc(recoveryReason(st.by))}</p>`;
    more += sleepHomeHtml();   // Santé : la nuit, une ligne (js/features/apple-services.js)
    const passed = passedOverNote(keys, next);
    if (passed) more += `<p class="hero__why hero__why--passed">${esc(passed)}</p>`;
    btn = st.ready || queue
      ? `<button class="hero__btn" data-action="start-session" data-cat="${esc(next)}" aria-label="Démarrer ${esc(sessionTitle(next))}"${warn ? ' aria-describedby="hero-warn"' : ''}>${icon('play', 18)}Démarrer</button>`
      : `<button class="hero__btn hero__btn--gray" data-action="start-session" data-cat="${esc(next)}">Démarrer quand même</button>`;
  }
  const desc = meta.desc || coachSessionDesc(data.activeProgramme, next);
  // « Modifier les exercices » vit dans l'en-tête des cibles ; sans cibles (séance en cours, séance
  // vide), un lien sous le bouton le remplace, comme avant la refonte
  const targets = liveHere ? '' : targetsHtml(next);
  const edit = targets ? '' : `<button class="hero__edit" data-action="go-editor" data-cat="${esc(next)}">Modifier les exercices</button>`;
  return {
    meta, facts, more, btn, warn, targets, edit, spot: heroBtnSpot(),
    eyebrow: liveHere ? 'Séance en cours' : 'Prochaine séance',
    desc: desc ? `<p class="hero__desc">${desc}</p>` : '',
  };
}

// En haut, le nom (titre moyen), les muscles et les infos à gauche, la vignette du groupe principal à droite ; l'attente
// et ses raisons dessous, sur toute la largeur ; puis Démarrer et les cibles. Texte agrandi : plus de vignette, le texte
// prend toute la largeur, Démarrer passe sous le nom (heroBtnSpot).
function heroHtml(keys, next, liveHere) {
  const h = heroParts(keys, next, liveHere);
  const art = sessionThumbHtml(next, 'hero__thumb');
  return `
    <section class="hero${art ? '' : ' hero--noart'}" aria-label="${h.eyebrow}">
      <div class="hero__top">
        <div class="hero__text">
          <p class="hero__eyebrow">${h.eyebrow}</p>
          <h2 class="hero__name">${esc(sessionTitle(next))}</h2>
          ${h.spot === 'top' ? h.warn + h.btn : ''}
          ${h.desc}
          ${h.facts}
        </div>
        ${art}
      </div>
      ${h.spot === 'top' ? '' : h.warn}${h.more}
      ${h.spot === 'mid' ? h.btn : ''}${h.targets}
      ${h.edit}
    </section>`;
}

// ── Illustrations : toujours décoratives (alt vide, aria-hidden) ; VoiceOver lit le nom et les infos écrites ──
// Groupe principal d'une séance du programme (mainGroupOf, js/features/progress-muscles.js) : Push → pectoraux, Pull → dos, Legs → jambes
function sessionGroup(cat) {
  return mainGroupOf(prog().exercises[cat] || []);
}
// Vignette du groupe (img/muscles/<groupe>.webp, 600 × 400, celle de la Bibliothèque) ; fichier absent : rien
// (classe mgc__img : js/ui/vivant.js la marque data-missing et la cache)
function sessionThumbHtml(cat, className) {
  const g = sessionGroup(cat);
  return g ? `<img class="mgc__img ${className}" src="img/muscles/${g}.webp" alt="" aria-hidden="true" width="600" height="400" decoding="async">` : '';
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

// « Autres séances » (et non « Ensuite », qui laissait croire à un ordre : panel vague 4) : les autres séances du
// programme en cartes illustrées, comme les groupes de la Bibliothèque : nom, infos et état (« Prête », « Prête dans
// 1 j 18 h ») à gauche, vignette du groupe principal à droite. Intitulé VoiceOver = le texte affiché (image décorative)
// Les muscles écrits (« Pectoraux · Épaules · Triceps ») restent quand la vignette disparaît (texte agrandi), comme
// sur la carte de la prochaine séance ; le chevron dit que la carte se touche (feuille d'actions)
function otherSessionHtml(cat) {
  const n = (prog().exercises[cat] || []).length, mins = sessionMinutes(cat), meta = sessionMeta(cat);
  const facts = [plural(n, 'exercice', 'exercices'), mins ? `≈ ${mins} min` : ''].filter(Boolean).join(' · ');
  const desc = meta.desc || coachSessionDesc(data.activeProgramme, cat);
  return `
      <button class="home-cell mgc" data-action="session-actions" data-cat="${esc(cat)}">
        <span class="home-cell__text mgc__text"><span class="home-cell__name">${esc(sessionTitle(cat))}</span>${desc ? `<span class="home-cell__desc">${desc}</span>` : ''}<span class="home-cell__sub num">${facts}</span>
          <span class="home-cell__right" data-status-cat="${esc(cat)}">${cellStatusHtml(cat)}</span></span>
        ${sessionThumbHtml(cat, 'home-cell__img')}
        ${icon('chevron.right', 14)}
      </button>`;
}

// « Séance libre » (regard neuf du 16/11 : rien pour s'entraîner hors programme, en direct) : une ligne sous les séances,
// qui démarre une séance vide où l'on ajoute ses exercices (séance en cours habituelle, programme FREE : rien ne change
// dans le programme, l'historique et les progrès la comptent). En cours : elle se reprend d'ici
function freeSessionRowHtml() {
  const live = activeSession?.programme === FREE;
  return `
      <div class="home-card home-free">
        <button class="home-cell" data-action="${live ? 'resume-session' : 'start-free-session'}">
          <span class="home-cell__text"><span class="home-cell__name">Séance libre</span>
            <span class="home-cell__sub">${live ? 'En cours' : 'Ajoute tes exercices au fil de la séance'}</span></span>
          ${live ? '<span class="home-cell__status home-cell__status--live">Reprendre</span>' : ''}
          ${icon('chevron.right', 14)}
        </button>
      </div>`;
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

  const hero = next ? heroHtml(keys, next, liveHere) : '';
  const others = otherSessions(keys, next).map(otherSessionHtml).join('');
  const queue = isUserProg(data.activeProgramme);

  const emptyCustom = isUserProg(data.activeProgramme) && keys.length === 0
    ? `<div class="empty-state">
         <div>Programme vide</div>
         <div class="empty-state__sub">Ajoute des séances dans l'onglet Programme</div>
       </div>`
    : '';

  const date = fmtDate(Date.now(), 'day');
  const right = settingsButtonHtml();
  const from = coachFromLine(data.activeProgramme);   // programme reçu d'un coach (js/features/coach-ui.js)
  const sub = `<button class="navbar__sub" data-action="go-active-programme" aria-label="Programme ${esc(pm.name)}${from ? `, ${from}` : ''}">${navSubWithChevron(`Programme ${pm.name}`)}</button>${from ? `<p class="coach-from coach-from--home">${from}</p>` : ''}`;

  const week = keys.length ? weekCard(weekStats()) : '';
  // Programme créé : « Ensuite » (la file) et « Changer l'ordre », qui ouvre l'ordre des séances dans la page du programme
  // (une seule place pour régler un programme, vote du 19/11)
  const orderBtn = queue && keys.length > 1 ? '<button class="home-list__btn" data-action="open-session-order">Changer l\'ordre</button>' : '';
  const othersList = others ? `<section class="home-list" aria-labelledby="homeNext"><div class="home-list__head"><h2 class="home-list__title" id="homeNext">${queue ? 'Ensuite' : 'Autres séances'}</h2>${orderBtn}</div><div class="home-card">${others}</div></section>` : '';
  // Toutes les séances d'abord (la prochaine, les autres, la séance libre), puis Nutrition, les cartes (récap, compte,
  // sauvegarde, coach) et la semaine. Nutrition (seulement avec un plan, donc choisie) passe devant les cartes : elle
  // sert chaque jour, elles de temps en temps ; jamais devant les séances (l'accueil reste celui de l'entraînement)
  const saveCard = accountHomeCard() || backupHomeCard();   // une seule carte de sauvegarde à la fois
  // Bilan demandé par le coach (js/features/checkin-ui.js) : avant les autres cartes du coach, il a une date limite
  const cards = hero ? `${recapHomeCard()}${saveCard}${checkinHomeCard()}${coachHomeCard()}` : `${saveCard}${checkinHomeCard()}${recapHomeCard()}`;

  return `
    <div class="view dashboard">
      ${navBar({ title: 'Entraînement', largeTitle: date, right, sub })}
      <div class="home">
        ${accessBannerHtml()}
        ${hero || emptyCustom}
        ${othersList}
        ${freeSessionRowHtml()}
        ${nutritionHomeCard()}
        ${cards}
        ${week}
        ${defisHomeHtml()}
      </div>
    </div>`;
}

// Feuille d'actions d'une séance de l'accueil
async function sessionActions(cat) {
  const st = catStatus(cat);
  const queue = isUserProg(data.activeProgramme), canReorder = queue && sessionKeys().length > 1;
  const choice = await dialog({ type: 'sheet', title: sessionTitle(cat),
    // Le temps restant d'abord, comme sur la carte (« Il reste 1 j 18 h de récupération (épaules antérieures) »)
    ...(!st.ready ? { message: `${recoveryWarning(st).replace(/^Attention : i/, 'I')}.${st.by ? ` ${recoveryReason(st.by)}` : ''}` } : {}), actions: [
    { label: 'Démarrer', value: 'start', style: 'preferred' },
    ...(!st.ready && !queue ? [{ label: 'Ignorer le délai', value: 'skip' }] : []),
    { label: 'Voir les exercices', value: 'see' },
    ...(canReorder ? [{ label: 'Changer l\'ordre', value: 'order' }] : []),
    { label: 'Annuler', style: 'cancel' },
  ] });
  if (choice === 'start') return startSessionFlow(cat);
  if (choice === 'order') return openSessionOrder();
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
    // Minuit passé, accueil resté ouvert : les défis repartent de zéro (jour lu à chaque minute, heure locale)
    const dh = document.querySelector('.defis-home');
    if (dh && dh.dataset.day !== localISO()) { defiRefresh(); render(); return; }
    // Une séance devient prête : on redessine l'accueil (la carte « Prochaine séance » peut changer)
    const keys = sessionKeys();
    const statusEl = k => $(`[data-status-cat="${CSS.escape(k)}"]`);
    if (keys.some(k => { const s = statusEl(k); return s && catStatus(k).ready && !s.querySelector('.home-cell__status--ready'); })
        || (($('#hero-wait') || $('#hero-warn')) && catStatus(nextSessionCat(keys)).ready)) { render(); return; }
    keys.forEach(k => { const s = statusEl(k); if (s) s.innerHTML = cellStatusHtml(k); });
    const hw = $('#hero-wait'), warn = $('#hero-warn');
    if (hw) hw.textContent = `Prochaine séance prête dans ${fmtWait(catStatus(nextSessionCat(keys)).remaining)}`;
    if (warn) warn.textContent = recoveryWarning(catStatus(nextSessionCat(keys)));   // programme créé : le décompte de l'avertissement
  };
  tick();
  ticker = setInterval(tick, 1000);
}

// Démarrer une séance : refusée si elle est vide (sauf la séance libre, vide par nature) ; si une autre séance est
// en cours, on propose de la reprendre ou de l'abandonner. cat FREE : séance libre en direct
async function startSessionFlow(cat) {
  // Mode lecture seule (verrou allumé, plus le droit d'écrire) : l'abonnement est proposé, rien n'est touché
  if (!(await accessGate())) return;
  const free = cat === FREE;
  if (!free && !(prog().exercises[cat] || []).length) {
    await dialog({ title: 'Aucun exercice', message: 'Ajoute un exercice pour démarrer cette séance.', actions: [{ label: 'OK', style: 'preferred' }] });
    return;
  }
  if (activeSession) {
    const choice = await dialog({ type: 'sheet', title: 'Une séance est déjà en cours',
      message: `${rawLabel(activeSession.category, activeSession.programme)} a commencé il y a ${fmtDuration(Date.now() - activeSession.startedAt)}.`,
      actions: [
        { label: 'Reprendre', value: 'resume', style: 'preferred' },
        { label: `Abandonner et démarrer ${free ? 'une séance libre' : rawLabel(cat)}`, value: 'replace', style: 'destructive' },
        { label: 'Annuler', style: 'cancel' },
      ] });
    if (choice === 'resume') { navigate('session'); return; }
    if (choice !== 'replace') return;
    endSession();
  }
  playMelody('tick');
  haptic();
  startSession(cat);
  if (free) openAddExSheet();   // séance vide : on choisit tout de suite son premier exercice
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'session-actions': async (e, el) => {
    await sessionActions(el.dataset.cat);
  },
  'start-session': async (e, el) => {
    await startSessionFlow(el.dataset.cat);
  },
  'start-free-session': async () => {
    await startSessionFlow(FREE);
  },
});
