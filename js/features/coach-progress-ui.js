// ═══════════════════════════════════════════════════════════
//  Progression des élèves, écrans du coach : le signal de chaque ligne de Mes élèves, le tri et sa
//  phrase d'explication, et le résumé « 7 derniers jours » en tête de la fiche d'un élève.
//  Règles (pures, testées) : js/data/coach-progress.js ; contrat : docs/COACH_SUIVI.md, « Progression ».
//
//  Une couleur, un sens : vert avec ↑ = record, orange = à relancer, gris = rien à faire. Le texte dit
//  toujours la même chose que la couleur (VoiceOver, daltonisme). Une ligne d'élève tient en 3 lignes :
//  nom, signal, puis sa phase en cours (ou à venir) ou, sans planning, sa dernière séance.
//  Rien au pointerdown : la ligne et les cellules s'ouvrent au clic.
// ═══════════════════════════════════════════════════════════
'use strict';

const PROGRESS_SUMMARY_RECORDS = 3;   // fiche : records listés, les suivants comptés (« Et 2 autres records »)
const PROGRESS_SORT_FOOT = 'Ordre : nouveautés à lire, élèves à relancer, records des 7 derniers jours, puis les autres. Tes élèves ne se voient pas entre eux.';

// Signal d'une ligne : « 2 records en 7 jours » (médaille), « 9 jours sans séance » (à relancer)…
// À relancer : un triangle d'alerte devant le texte, au texte courant (l'orange reste à l'action, le rouge aux muscles)
function progressSignalHtml(pr) {
  // Record : la médaille au trait, comme la fiche et le bilan ; la flèche verte reste aux progressions (panel v4 t1)
  const arrow = pr.tone === 'up' ? `<span class="progress-sig__arrow" aria-hidden="true">${medalSvg(14)}</span>`
    : pr.tone === 'warn' ? `<span class="progress-sig__alert" aria-hidden="true">${icon('exclamationmark.triangle', 14)}</span>` : '';
  return `<span class="cell__sub progress-sig progress-sig--${pr.tone}">${arrow}${esc(pr.text)}</span>`;
}

// ── Carte d'un élève (refonte Coach v2, 15/11) ──────────────
// Dans le style de l'accueil et de l'Historique : à gauche une vignette carrée du groupe travaillé à sa dernière
// séance (img/muscles/<groupe>.webp, décorative), son avatar posé dans le coin ; sans groupe connu, l'avatar seul.
// Au milieu : nom et, à sa droite, la régularité des 7 derniers jours (un point par jour, aujourd'hui à droite), signal
// (alerte s'il décroche), dernière séance ou phase, puis les pastilles de nouveautés. Texte agrandi : plus de vignette.
// Rien de nouveau n'est montré : la dernière séance, ses exercices et ses dates sont déjà ceux de sa fiche.

// Groupe de sa dernière séance : ses exercices s'ils sont déjà reçus (première page de ses séances), sinon ceux de
// la séance de même nom du programme d'où elle vient (le mien, ou un programme intégré) ; null sinon
function studentLastGroup(st) {
  const ls = st?.last_session;
  if (!ls) return null;
  const row = coach.sessions?.[st.user_id]?.rows?.[0];
  if (row && row.doneAt === ls.done_at) return sessionGroupOf(row.s.exercises);
  const prog = coachSentIdOf(ls.programme, account.user?.id) || ls.programme;
  if (!prog) return null;
  const key = progSessionsOf(data, prog).find(x => normName(x.label) === normName(ls.label))?.key;
  return key ? sessionGroupOf(data.programmes?.[prog]?.exercises?.[key]) : null;
}
// Séances par jour sur les 7 derniers jours (du plus ancien à aujourd'hui), seulement si toute la période est connue
// (faits de progression ou séances reçues), ou s'il n'a fait aucune séance de la semaine (coach_state le dit) ; null sinon,
// et null pour un élève qui n'a encore aucune séance
function studentDays(st, now = Date.now()) {
  if (!st.last_session) return null;   // jamais venu : le signal le dit, pas de semaine vide en plus
  const f = coachProgressFacts(st.user_id);
  if (f && f.from <= progressDayStart(now, 6)) {
    const days = Array(7).fill(0);
    f.sessions.forEach(x => { const d = Math.max(0, daysAgo(x.at, now)); if (d <= 6) days[6 - d]++; });
    return days;
  }
  return st.last_session && !st.sessions_7d ? Array(7).fill(0) : null;
}
// Les 7 points (décoratifs) et leur phrase pour VoiceOver
function studentDaysHtml(days) {
  if (!days) return '';
  const n = days.filter(Boolean).length;
  return `<span class="cstu__days" aria-hidden="true">${days.map((x, i) => `<span class="cstu__day${x ? ' cstu__day--on' : ''}${i === 6 ? ' cstu__day--today' : ''}"></span>`).join('')}</span><span class="visually-hidden">, ${n ? `${plural(n, 'jour', 'jours')} de séance sur les 7 derniers` : 'aucune séance ces 7 derniers jours'}</span>`;
}
// Vignette (ou avatar seul) de la carte
function studentPicHtml(st) {
  const g = studentLastGroup(st);
  return `<span class="cstu__pic${g ? '' : ' cstu__pic--avatar'}">${g ? progThumbHtml(g, 'cstu__img') : ''}${personAvatar(st)}</span>`;
}

// Mes élèves : les élèves triés (sortStudentsByProgress), avec leur signal
function coachSortedStudents(students, now = Date.now()) {
  return sortStudentsByProgress(students, st => coachStudentProgress(st, now), st => chatUnreadOf(st.user_id))
    .map(({ st, pr }) => ({ st, pr }));
}
// Cloche barrée : cet élève ne reçoit pas mes messages en notification (coach_push_off, js/data/coach-chat.js)
function pushOffMarkHtml(uid) {
  return chatPushOffOf(uid) ? `<span class="push-off-mark" aria-hidden="true">${icon('bell.slash', 14)}</span><span class="visually-hidden">, notifications coupées</span>` : '';
}
// Carte d'un élève : texte en 3 lignes au plus (nom et régularité à sa droite, signal, dernière séance ou phase), les
// pastilles sur une ligne à part dessous
function coachStudentRowHtml(s, pr, now = Date.now()) {
  const unread = chatUnreadOf(s.user_id);
  // « Pas encore de séance » (signal) dit déjà ce que dirait « Aucune séance pour l'instant » : un seul message
  // (panel Apple de la vague 3) ; la 3e ligne ne reste que pour un planning
  const third = coachStudentPlanLine(s.user_id) || (pr.kind === 'never' ? '' : `<span class="cell__sub">${esc(studentLastLine(s))}</span>`);
  const days = studentDaysHtml(studentDays(s, now));
  const badges = s.new_sessions || unread ? `<span class="cs-badges">${sessionsBadgeHtml(s.new_sessions)}${chatBadgeHtml(unread)}</span>${unread ? `<span class="visually-hidden">, ${plural(unread, 'message non lu', 'messages non lus')}</span>` : ''}` : '';
  return `
          <button class="cell cell--nav social-row coach-student-row cstu${pr.tone === 'warn' ? ' cstu--warn' : ''}" data-action="coach-open-student" data-uid="${esc(s.user_id)}" data-signal="${esc(pr.kind)}" data-name="${esc(personName(s))}">
            <span class="social-row__main">${studentPicHtml(s)}<span class="cstu__col"><span class="social-row__text">
              <span class="cstu__top"><span class="social-row__name">${esc(personName(s))}</span>${pushOffMarkHtml(s.user_id)}${days}</span>
              ${pr.kind === 'new' && !coachStudentPlanLine(s.user_id) ? '' : progressSignalHtml(pr)}
              ${third}
            </span>${badges ? `<span class="cstu__foot">${badges}</span>` : ''}</span></span>
            ${icon('chevron.right', 16)}
          </button>`;
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

// Ses séances par tranches de 7 jours glissants (aujourd'hui et les 6 jours d'avant, puis les 3 tranches d'avant), comme
// le signal de la liste : un seul sens de « semaine » partout (panel coach t1). Première page chargée, seulement si elle
// couvre les 28 jours ; null sinon. Les barres (weekBarsSvg) disent elles-mêmes les nombres à VoiceOver
function progressWeekCounts(uid) {
  const f = coachSessions(uid), now = Date.now();
  const oldest = f.rows[f.rows.length - 1]?.doneAt;
  const covered = f.end || (oldest && new Date(oldest).getTime() <= progressDayStart(now, 27));
  if (!f.rows.length || !covered) return null;
  const sessions = f.rows.map(r => ({ at: new Date(r.doneAt).getTime() }));
  return [3, 2, 1, 0].map(k => progressWeekCount(sessions, k, now));
}

// Fiche d'un élève, sous la carte de tête : « 7 derniers jours » (glissants, panel vague 4 : « Cette semaine » se
// confondait avec la semaine du calendrier de l'accueil). Le signal (seulement s'il dit autre chose que les lignes
// en dessous : à relancer, stable), les séances faites sur prévues, les records avec l'exercice. La dernière séance
// est dans la carte de tête (coachStudentHeroHtml, js/features/coach-ui.js).
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
  const sessions = progressSessionsCell(pr, planned, counts ? weekBarsSvg(counts, 'par 7 jours', { rolling: true }) : '');
  return `
        <div class="group-title">7 derniers jours</div>
        <div class="group progress-week">${sig}${sessions}${recs}${none}${more}</div>
        <div class="group-foot">Aujourd'hui et les 6 jours d'avant. Les barres comptent les séances par tranches de 7 jours.</div>`;
}

// En tête de Mes élèves : « 7 derniers jours » (glissants, comme le signal de chaque élève), trois chiffres d'un coup d'œil (records battus, élèves à relancer,
// nouveautés à lire), avec la même couleur que les lignes (vert ↑, orange, teinte). Rien à toucher : c'est
// la liste triée en dessous qui mène aux élèves. VoiceOver lit une phrase.
function coachTeamWeekHtml(students) {
  if (!students?.length) return '';
  const now = Date.now();
  const w = teamWeekSummary(students, st => coachStudentProgress(st, now), st => chatUnreadOf(st.user_id));
  const tile = (val, lbl, tone) => `<span class="team-week__tile${val ? ` team-week__tile--${tone}` : ''}"><span class="team-week__val num">${val && tone === 'up' ? `${medalSvg(14)} ` : ''}${val}</span> <span class="team-week__lbl">${lbl}</span></span>`;
  const spoken = `7 derniers jours : ${plural(w.records, 'record', 'records')}, ${plural(w.warn, 'élève', 'élèves')} à relancer, ${plural(w.fresh, 'nouveauté', 'nouveautés')} à lire.`;
  return `
        <div class="group-title">7 derniers jours</div>
        <div class="team-week" role="img" aria-label="${esc(spoken)}">
          ${tile(w.records, w.records > 1 ? 'records' : 'record', 'up')}
          ${tile(w.warn, 'à relancer', 'warn')}
          ${tile(w.fresh, w.fresh > 1 ? 'nouveautés' : 'nouveauté', 'new')}
        </div>`;
}
