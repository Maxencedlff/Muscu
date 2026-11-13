// ═══════════════════════════════════════════════════════════
//  Progression des élèves, écrans du coach : le signal de chaque ligne de Mes élèves, le tri et sa
//  phrase d'explication, et le résumé « Cette semaine » en tête de la fiche d'un élève.
//  Règles (pures, testées) : js/data/coach-progress.js ; contrat : docs/COACH_SUIVI.md, « Progression ».
//
//  Une couleur, un sens : vert avec ↑ = record, orange = à relancer, gris = rien à faire. Le texte dit
//  toujours la même chose que la couleur (VoiceOver, daltonisme). Une ligne d'élève tient en 3 lignes :
//  nom, signal, puis sa phase en cours (ou à venir) ou, sans planning, sa dernière séance.
//  Rien au pointerdown : la ligne et les cellules s'ouvrent au clic.
// ═══════════════════════════════════════════════════════════
'use strict';

const PROGRESS_SUMMARY_RECORDS = 3;   // fiche : records listés, les suivants comptés (« Et 2 autres records »)
const PROGRESS_SORT_FOOT = 'En haut, les nouveautés à lire, puis les élèves à relancer, puis ceux qui ont battu un record cette semaine, puis les autres. Tes élèves ne se voient pas entre eux.';

// Signal d'une ligne : « ↑ 2 records cette semaine » (vert), « Pas de séance depuis 9 jours » (orange)…
function progressSignalHtml(pr) {
  // Record : la médaille au trait, comme la fiche et le bilan ; la flèche verte reste aux progressions (panel v4 t1)
  const arrow = pr.tone === 'up' ? `<span class="progress-sig__arrow" aria-hidden="true">${medalSvg(14)}</span>` : '';
  return `<span class="cell__sub progress-sig progress-sig--${pr.tone}">${arrow}${esc(pr.text)}</span>`;
}

// Mes élèves : les lignes triées (sortStudentsByProgress), chacune en 3 lignes au plus
function coachStudentRowsHtml(students) {
  const now = Date.now();
  return sortStudentsByProgress(students, st => coachStudentProgress(st, now), st => chatUnreadOf(st.user_id)).map(({ st: s, pr }) => {
    const unread = chatUnreadOf(s.user_id);
    // « Pas encore de séance » (signal) dit déjà ce que dirait « Aucune séance pour l'instant » : un seul message
    // (panel Apple de la vague 3) ; la 3e ligne ne reste que pour un planning
    const third = coachStudentPlanLine(s.user_id) || (pr.kind === 'never' ? '' : `<span class="cell__sub">${esc(studentLastLine(s))}</span>`);
    return `
          <button class="cell cell--nav social-row coach-student-row" data-action="coach-open-student" data-uid="${esc(s.user_id)}" data-signal="${esc(pr.kind)}" data-name="${esc(personName(s))}"${coachSearchQ && !normName(personName(s)).includes(normName(coachSearchQ)) ? ' hidden' : ''}>
            <span class="social-row__main">${personAvatar(s)}<span class="social-row__text">
              <span class="social-row__name">${esc(personName(s))}</span>
              ${pr.kind === 'new' && !coachStudentPlanLine(s.user_id) ? '' : progressSignalHtml(pr)}
              ${third}
            </span></span>
            ${s.new_sessions || unread ? `<span class="cs-badges">${sessionsBadgeHtml(s.new_sessions)}${chatBadgeHtml(unread)}</span>` : ''}${unread ? `<span class="visually-hidden">, ${plural(unread, 'message non lu', 'messages non lus')}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>`;
  }).join('');
}

// Séances prévues par semaine : celles du programme de sa phase en cours, si c'est un de mes programmes
// (le planning ne garde que le nom du programme : docs/COACH_SUIVI.md). null sinon.
function progressPlannedOf(uid) {
  if (!planAvailable()) return null;
  const cur = planCurrent(planOfStudent(uid) || []);
  if (!cur?.progName) return null;
  const id = coachSendableProgrammes().find(x => normName(progMeta(x).name) === normName(cur.progName));
  const n = id ? progSessionsOf(data, id).length : 0;
  return n ? { n, name: cur.progName } : null;
}

// Séances de la semaine : valeur courte à droite (« 3 sur 4 », « 2 ») et détail dessous
// (« Prévues : Sèche 4 jours », « 3 d'habitude »)
function progressSessionsCell(pr, planned, bars = '') {
  const value = planned ? `${pr.n7} sur ${planned.n}` : String(pr.n7);
  const sub = planned ? `Prévues : ${planned.name}` : pr.habit !== null && pr.habit >= 1 ? `${fmtNum(pr.habit)} d'habitude` : '';
  const spoken = planned ? `${pr.n7} sur ${planned.n} prévues` : value;
  return `
          <div class="cell progress-week__row" aria-label="${esc(`Séances : ${spoken}${sub && !planned ? `, ${sub}` : planned ? `, programme ${planned.name}` : ''}`)}" role="group">
            <span class="cell__body"><span class="cell__title">Séances</span>${sub ? `<span class="cell__sub">${esc(sub)}</span>` : ''}</span>
            ${bars}<span class="cell__value num">${esc(value)}</span>
          </div>`;
}

// Ses séances des 4 dernières semaines du calendrier (première page chargée), seulement si elle couvre toute la
// période ; null sinon. Les barres (weekBarsSvg) disent elles-mêmes les nombres à VoiceOver
function progressWeekCounts(uid) {
  const f = coachSessions(uid), now = Date.now();
  const oldest = f.rows[f.rows.length - 1]?.doneAt;
  const covered = f.end || (oldest && new Date(oldest).getTime() <= weekStartMs(now, 3));
  return f.rows.length ? weekCounts(f.rows.map(r => new Date(r.doneAt).getTime()), now, 4, !!covered) : null;
}

// Fiche d'un élève, en tête : « 7 derniers jours » (glissants, panel vague 4 : « Cette semaine » se confondait avec la
// semaine du calendrier de l'accueil). Le signal (seulement s'il dit autre chose que les lignes
// en dessous : à relancer, stable), les séances faites sur prévues, les records avec l'exercice, la
// dernière séance (elle s'ouvre si elle est chargée).
function coachWeekSummaryHtml(uid) {
  const st = coachStudent(uid);
  if (!st) return '';
  const pr = coachStudentProgress(st), planned = progressPlannedOf(uid);
  const sig = pr.tone === 'warn' || pr.kind === 'stable' ? `<div class="cell progress-week__sig" role="status">${progressSignalHtml(pr)}</div>` : '';
  const recs = pr.records.slice(0, PROGRESS_SUMMARY_RECORDS).map(x => notedRecordCell(x.r)).join('');
  const none = !pr.records.length && coachProgressFacts(uid)
    ? '<div class="cell"><span class="cell__body"><span class="cell__title">Records</span></span><span class="cell__value">Aucun</span></div>' : '';
  const more = pr.records.length > PROGRESS_SUMMARY_RECORDS
    ? `<div class="cell"><span class="cell__sub">Et ${plural(pr.records.length - PROGRESS_SUMMARY_RECORDS, 'autre record', 'autres records')}, dans ses séances</span></div>` : '';
  const counts = progressWeekCounts(uid);
  const sessions = progressSessionsCell(pr, planned, counts ? weekBarsSvg(counts) : '');
  const row = coachSessions(uid).rows[0];
  const lastTxt = st.last_session ? studentLastLine(st) : 'Pas encore de séance';
  const last = row && st.last_session && row.doneAt === st.last_session.done_at
    ? `<button class="cell cell--nav" data-action="coach-open-session" data-uid="${esc(uid)}" data-id="${esc(row.id)}">
            <span class="cell__body"><span class="cell__title">Dernière séance</span><span class="cell__sub">${esc(lastTxt)}</span></span>
            ${icon('chevron.right', 16)}
          </button>`
    : `<div class="cell"><span class="cell__body"><span class="cell__title">Dernière séance</span><span class="cell__sub">${esc(lastTxt)}</span></span></div>`;
  return `
        <div class="group-title">7 derniers jours</div>
        <div class="group progress-week">${sig}${sessions}${recs}${none}${more}${last}</div>
        <div class="group-foot">Aujourd'hui et les 6 jours d'avant. Les barres comptent les séances par semaine, du lundi au dimanche.</div>`;
}

// En tête de Mes élèves : « Cette semaine », trois chiffres d'un coup d'œil (records battus, élèves à relancer,
// nouveautés à lire), avec la même couleur que les lignes (vert ↑, orange, teinte). Rien à toucher : c'est
// la liste triée en dessous qui mène aux élèves. VoiceOver lit une phrase.
function coachTeamWeekHtml(students) {
  if (!students?.length) return '';
  const now = Date.now();
  const w = teamWeekSummary(students, st => coachStudentProgress(st, now), st => chatUnreadOf(st.user_id));
  const tile = (val, lbl, tone) => `<span class="team-week__tile${val ? ` team-week__tile--${tone}` : ''}"><span class="team-week__val num">${val && tone === 'up' ? `${medalSvg(14)} ` : ''}${val}</span> <span class="team-week__lbl">${lbl}</span></span>`;
  const spoken = `Cette semaine : ${plural(w.records, 'record', 'records')}, ${plural(w.warn, 'élève', 'élèves')} à relancer, ${plural(w.fresh, 'nouveauté', 'nouveautés')} à lire.`;
  return `
        <div class="group-title">Cette semaine</div>
        <div class="team-week" role="img" aria-label="${esc(spoken)}">
          ${tile(w.records, w.records > 1 ? 'records' : 'record', 'up')}
          ${tile(w.warn, 'à relancer', 'warn')}
          ${tile(w.fresh, w.fresh > 1 ? 'nouveautés' : 'nouveauté', 'new')}
        </div>`;
}
