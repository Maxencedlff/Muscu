// ═══════════════════════════════════════════════════════════
//  Planification du coach, écrans. Données et appels : js/data/coach-plan.js ; contrat :
//  docs/COACH_SUIVI.md, « Planification ».
//
//  - Coach : Mes élèves › Planning (`coach-planning` : une ligne par élève sur 16 semaines, la semaine en
//    cours marquée), ligne « Mini cut · sem. 3/6 » de chaque élève, groupe « Planification » de sa fiche,
//    planning d'un élève (`coach-plan:UID` : frise proportionnelle, phases en cours, à venir, terminées),
//    feuille d'une phase (nom, objectif, début, durée, programme, note ; « Supprimer la phase »).
//  - Élève : « Ta phase » dans Mon coach (carte en lecture seule, prochaine phase), et la phase en cours
//    discrète sous le nom du coach dans l'onglet Social.
//  - Serveur sans planification, ou rien de lu : rien ne s'affiche (planAvailable()).
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const PLAN_GANTT_WEEKS = 16, PLAN_GANTT_BEFORE = 3;   // vue d'ensemble : 3 semaines passées, la semaine en cours, 12 à venir

// ── Petits gabarits ─────────────────────────────────────────

function planGoalPill(goal) {
  const g = planGoal(goal);
  return `<span class="plan-pill" style="--plan-color:${g.color}"><span class="plan-pill__dot" aria-hidden="true"></span>${esc(g.label)}</span>`;
}

// Semaines de la phase : une case par semaine (pleine = passée, marquée = en cours) ; au-delà de 16, une barre
function planWeeksHtml(p, g) {
  const label = g.status === 'current' ? `Semaine ${g.week} sur ${p.weeks}` : g.status === 'done' ? `${plural(p.weeks, 'semaine', 'semaines')}, terminée` : plural(p.weeks, 'semaine', 'semaines');
  const color = planGoal(p.goal).color;
  if (p.weeks > 16) {
    const pct = g.status === 'done' ? 100 : g.status === 'current' ? Math.round((g.day / (p.weeks * 7)) * 100) : 0;
    return `<span class="plan-bar" role="img" aria-label="${esc(label)}" style="--plan-color:${color}"><span style="width:${pct}%"></span></span>`;
  }
  const cells = Array.from({ length: p.weeks }, (_, i) => {
    const n = i + 1;
    const cls = g.status === 'done' || n < g.week ? 'is-done' : n === g.week && g.status === 'current' ? 'is-now' : '';
    return `<span class="${cls}"></span>`;
  }).join('');
  return `<span class="plan-weeks" role="img" aria-label="${esc(label)}" style="--plan-color:${color}">${cells}</span>`;
}

// Carte d'une phase. tap : action du coach (modifier) ; sinon en lecture seule (élève)
function planPhaseCardHtml(p, { uid = null, today = planToday() } = {}) {
  const g = phaseProgress(p, today);
  const status = phaseStatusText(p, today);
  const left = g.status === 'current' ? (g.daysLeft === 1 ? 'Dernier jour' : `Encore ${plural(g.daysLeft, 'jour', 'jours')}`) : '';
  const meta = [phaseRangeText(p), p.progName ? `Programme : ${p.progName}` : ''].filter(Boolean);
  const inner = `
          <span class="plan-card__top">${planGoalPill(p.goal)}<span class="plan-card__status num">${esc(status)}</span></span>
          <span class="plan-card__title">${esc(phaseTitle(p))}</span>
          ${planWeeksHtml(p, g)}
          <span class="plan-card__meta">${meta.map(esc).join('<br>')}${left ? `<br><span class="num">${esc(left)}</span>` : ''}</span>
          ${uid && p.note ? `<span class="plan-card__note">${esc(p.note)}</span>` : ''}`;
  const cls = `plan-card plan-card--${g.status}`;
  return uid
    ? `<button class="${cls}" data-action="plan-edit" data-uid="${esc(uid)}" data-id="${p.id}" aria-label="${esc([`${phaseTitle(p)}, ${planGoal(p.goal).label}, ${status}`,
        phaseRangeText(p), p.progName ? `Programme : ${p.progName}` : '', left, p.note ? `Ta note : ${p.note}` : '', 'Modifier'].filter(Boolean).join('. '))}">${inner}</button>`
    : `<div class="${cls}">${inner}</div>`;
}

// Frise proportionnelle de toutes les phases d'un élève, avec le jour présent marqué
function planTimelineHtml(phases, today = planToday()) {
  const list = planSorted(phases);
  if (!list.length) return '';
  const s0 = planDayNum(list[0].start), t = planDayNum(today);
  const end = Math.max(...list.map(p => planDayNum(p.start) + p.weeks * 7));
  const from = Math.min(s0, t), to = Math.max(end, t + 1), span = to - from;
  const pct = n => `${((n - from) / span) * 100}%`;
  const segs = list.map(p => {
    const s = planDayNum(p.start), w = (p.weeks * 7) / span * 100;
    return `<span class="plan-line__seg" style="left:${pct(s)};width:${w}%;--plan-color:${planGoal(p.goal).color}"></span>`;
  }).join('');
  const spoken = list.map(p => `${phaseTitle(p)}, ${plural(p.weeks, 'semaine', 'semaines')}, ${phaseRangeText(p).toLowerCase()}`).join(' ; ');
  return `
        <div class="plan-line" role="img" aria-label="${esc(`Frise : ${spoken}`)}">
          <div class="plan-line__today"><span style="left:${Math.min(88, Math.max(12, ((t + 0.5 - from) / span) * 100))}%">Aujourd'hui</span></div>
          <div class="plan-line__track">${segs}<span class="plan-line__now" style="left:${pct(t + 0.5)}"></span></div>
          <div class="plan-line__ends num"><span>${esc(fmtDate(planTs(planIsoOf(from)), 'short'))}</span><span>${esc(fmtDate(planTs(planIsoOf(to - 1)), 'short'))}</span></div>
        </div>`;
}

// ── Coach : ligne dans Mes élèves, groupe de la fiche ───────

// « Mini cut · sem. 3/6 », « Prochaine : Sèche, dans 5 jours », '' sans planning
function coachStudentPlanLine(uid) {
  if (!planAvailable()) return '';
  const phases = planOfStudent(uid);
  if (!phases?.length) return '';
  const cur = planCurrent(phases), next = planNext(phases);
  const p = cur || next;
  if (!p) return '';
  const g = phaseProgress(p);
  const txt = cur ? `${phaseTitle(p)} · sem. ${g.week}/${p.weeks}` : `Prochaine : ${phaseTitle(p)}, ${phaseStatusText(p).toLowerCase()}`;
  return `<span class="cell__sub plan-row-line" style="--plan-color:${planGoal(p.goal).color}"><span class="plan-pill__dot" aria-hidden="true"></span>${esc(txt)}</span>`;
}

function coachPlanGroupHtml(uid) {
  if (!planAvailable()) return '';
  const phases = planOfStudent(uid) || [];
  const cur = planCurrent(phases) || planNext(phases);
  const more = phases.length ? `
          <button class="cell cell--nav" data-action="plan-open" data-uid="${esc(uid)}">
            ${icon('calendar', 22)}<span class="cell__body"><span class="cell__title">Planning complet</span><span class="cell__sub">${plural(phases.length, 'phase', 'phases')}</span></span>
            ${icon('chevron.right', 16)}
          </button>` : '';
  return `
        <div class="group-title">Planification</div>
        ${cur ? planPhaseCardHtml(cur, { uid }) : ''}
        <div class="group${cur ? ' plan-after-card' : ''}">
          ${more}
          <button class="cell cell--action" data-action="plan-add" data-uid="${esc(uid)}">${icon('plus', 20)}<span>${phases.length ? 'Ajouter une phase' : 'Planifier une phase'}</span></button>
        </div>`;
}

// ── Coach : planning d'un élève ─────────────────────────────

function renderCoachPlan(uid) {
  const p = coachStudent(uid);
  const head = navBar({ title: 'Planning', large: false });
  const view = body => `<div class="view view--grouped coach-plan-view">${head}<div class="scr">${body}</div></div>`;
  if (!p) return view(`<div class="empty-note">${coach.state ? 'Cette personne ne fait plus partie de tes élèves.' : 'Chargement…'}</div>`);
  if (!planAvailable()) return view(plan.coachError ? coachOfflineNote(plan.coachError, 'Pas d\'Internet. Le planning s\'affichera quand le réseau reviendra.') : '<div class="empty-note">Chargement…</div>');
  const phases = planOfStudent(uid) || [], today = planToday();
  const by = st => phases.filter(x => phaseProgress(x, today).status === st);
  const section = (title, list) => list.length ? `<div class="group-title">${title}</div><div class="plan-cards">${list.map(x => planPhaseCardHtml(x, { uid, today })).join('')}</div>` : '';
  return view(`
        <h1 class="scr-title">${esc(personName(p))}</h1>
        <p class="scr-sub">${phases.length ? plural(phases.length, 'phase', 'phases') : 'Aucune phase pour l\'instant'}</p>
        ${planTimelineHtml(phases, today)}
        ${section('En cours', by('current'))}
        ${section('À venir', by('upcoming'))}
        ${section('Terminées', by('done').reverse())}
        <div class="group group--gap">
          <button class="cell cell--action" data-action="plan-add" data-uid="${esc(uid)}" ${plan.busy ? 'disabled' : ''}>${icon('plus', 20)}<span>Ajouter une phase</span></button>
        </div>
        <div class="group-foot">${esc(personName(p))} voit ses phases dans Mon coach, sans tes notes. Touche une phase pour la modifier.</div>`);
}
SCREENS.set('coach-plan', { render: uid => renderCoachPlan(uid), enter: () => coachPlanRefresh() });

// ── Coach : vue d'ensemble de tous les élèves ───────────────

function renderCoachPlanning() {
  const head = navBar({ title: 'Planning', large: false });
  const view = body => `<div class="view view--grouped coach-planning-view">${head}<div class="scr">${body}</div></div>`;
  const st = coach.state;
  if (!st || !planAvailable()) return view(plan.coachError || coach.error ? coachOfflineNote(plan.coachError || coach.error, 'Pas d\'Internet. Le planning s\'affichera quand le réseau reviendra.') : '<div class="empty-note">Chargement…</div>');
  if (!st.students.length) return view('<div class="empty-note">Aucun élève pour l\'instant. Invite ton premier élève depuis Mes élèves.</div>');
  const today = planToday(), t = planDayNum(today);
  // Fenêtre : du lundi de la semaine d'il y a 3 semaines, sur 16 semaines
  const monday = t - ((new Date(t * 86_400_000).getUTCDay() + 6) % 7);
  const from = monday - PLAN_GANTT_BEFORE * 7, span = PLAN_GANTT_WEEKS * 7, to = from + span;
  const pos = n => ((Math.min(Math.max(n, from), to) - from) / span) * 100;
  // Repères de mois : le 1er de chaque mois dans la fenêtre
  const months = [];
  for (let n = from; n < to; n++) {
    const iso = planIsoOf(n);
    // Début de la fenêtre : son mois seulement s'il en reste plus de 10 jours (sinon les deux noms se touchent)
    if (iso.endsWith('-01') || (n === from && +iso.slice(8) <= 20)) months.push(`<span style="left:${pos(n)}%">${esc(fmtDate(planTs(iso), 'short').replace(/^\d+\s/, ''))}</span>`);
  }
  const counts = { current: 0 };
  const rows = st.students.map(s => {
    const phases = planOfStudent(s.user_id) || [];
    const cur = planCurrent(phases, today), next = planNext(phases, today);
    if (cur) counts.current++;
    const bars = phases.filter(p => planDayNum(p.start) < to && planDayNum(p.start) + p.weeks * 7 > from).map(p => {
      const a = pos(planDayNum(p.start)), b = pos(planDayNum(p.start) + p.weeks * 7);
      return `<span class="plan-gantt__bar" style="left:${a}%;width:${b - a}%;--plan-color:${planGoal(p.goal).color}"></span>`;
    }).join('');
    const line = cur ? `${phaseTitle(cur)} · sem. ${phaseProgress(cur, today).week}/${cur.weeks}` : next ? `${phaseTitle(next)}, ${phaseStatusText(next, today).toLowerCase()}` : 'Rien de planifié';
    const spoken = `${personName(s)} : ${cur ? `${phaseTitle(cur)}, ${phaseStatusText(cur, today).toLowerCase()}` : next ? `prochaine phase ${phaseTitle(next)}, ${phaseStatusText(next, today).toLowerCase()}` : 'rien de planifié'}`;
    return `
          <button class="plan-gantt__row" data-action="plan-open" data-uid="${esc(s.user_id)}" aria-label="${esc(spoken)}">
            <span class="plan-gantt__who"><span class="plan-gantt__name">${esc(personName(s))}</span><span class="plan-gantt__sub${cur || next ? '' : ' is-empty'}">${esc(line)}</span></span>
            <span class="plan-gantt__track" aria-hidden="true">${bars}<span class="plan-gantt__now" style="left:${pos(t + 0.5)}%"></span></span>
          </button>`;
  }).join('');
  const legend = PLAN_GOALS.filter(g => st.students.some(s => (planOfStudent(s.user_id) || []).some(p => p.goal === g.goal)))
    .map(g => `<span class="plan-legend__item" style="--plan-color:${g.color}"><span class="plan-pill__dot" aria-hidden="true"></span>${esc(g.label)}</span>`).join('');
  return view(`
        <h1 class="scr-title">Planning</h1>
        <p class="scr-sub">${counts.current ? `${plural(counts.current, 'élève', 'élèves')} en phase cette semaine` : 'Aucun élève en phase cette semaine'}</p>
        <div class="plan-gantt">
          <div class="plan-gantt__head" aria-hidden="true"><span class="plan-gantt__who"></span><span class="plan-gantt__months">${months.join('')}</span></div>
          ${rows}
        </div>
        ${legend ? `<div class="plan-legend">${legend}</div>` : ''}
        <div class="group-foot">De ${esc(fmtDate(planTs(planIsoOf(from)), 'short'))} à ${esc(fmtDate(planTs(planIsoOf(to - 1)), 'short'))}, la ligne bleue est aujourd'hui. Touche un élève pour voir et modifier son planning.</div>`);
}
SCREENS.set('coach-planning', { render: () => renderCoachPlanning(), enter: () => coachPlanRefresh() });

// Cellule « Planning » en haut de Mes élèves
function coachPlanningCellHtml() {
  if (!planAvailable() || !coach.state?.students.length) return '';
  const n = coach.state.students.filter(s => planCurrent(planOfStudent(s.user_id) || [])).length;
  return `
        <div class="group">
          <button class="cell cell--nav" data-action="plan-overview">
            ${icon('calendar', 22)}<span class="cell__body"><span class="cell__title">Planning</span><span class="cell__sub">${n ? `${plural(n, 'élève', 'élèves')} en phase cette semaine` : 'Planifie les phases de tes élèves'}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Coach : feuille d'une phase ─────────────────────────────

// Programmes proposés : les miens qu'on peut envoyer, et celui déjà noté
function planProgrammeNames(current) {
  const names = coachSendableProgrammes().map(id => progMeta(id).name).filter(Boolean);
  if (current && !names.includes(current)) names.unshift(current);
  return [...new Set(names)].slice(0, 40);
}

async function planPhaseSheet(uid, phase = null) {
  const phases = planOfStudent(uid) || [];
  const f = phase ? { ...phase } : { id: null, name: '', goal: '', start: planNextStart(phases), weeks: 4, progName: null, note: '' };
  const chips = PLAN_GOALS.map(g => `
        <label class="plan-chip" style="--plan-color:${g.color}"><input type="radio" name="planGoal" value="${g.goal}"${f.goal === g.goal ? ' checked' : ''}><span>${esc(g.label)}</span></label>`).join('');
  const progs = planProgrammeNames(f.progName).map(n => `<option value="${esc(n)}"${n === f.progName ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const body = `
    <div class="plan-form">
      <fieldset class="plan-goals"><legend class="plan-form__label">Objectif</legend><div class="plan-chips">${chips}</div></fieldset>
      <label class="plan-form__row"><span class="plan-form__label">Nom</span>
        <input type="text" id="planName" class="field plan-form__input" maxlength="${PLAN_NAME_MAX}" autocomplete="off" enterkeyhint="done" value="${esc(f.name)}" placeholder="${esc(f.goal ? planGoal(f.goal).label : 'Facultatif')}"></label>
      <div class="plan-form__row"><label class="plan-form__label" for="planStart">Début</label>
        <input type="date" id="planStart" class="date-input" value="${esc(f.start)}" min="2020-01-01"></div>
      <div class="plan-form__row"><span class="plan-form__label" id="planWeeksLbl">Durée</span>
        <span class="plan-stepper">
          <button type="button" class="plan-stepper__btn" id="planWeeksDec" aria-label="Une semaine de moins">${icon('minus', 18)}</button>
          <output id="planWeeks" class="num" aria-labelledby="planWeeksLbl" aria-live="polite" data-weeks="${f.weeks}">${plural(f.weeks, 'semaine', 'semaines')}</output>
          <button type="button" class="plan-stepper__btn" id="planWeeksInc" aria-label="Une semaine de plus">${icon('plus', 18)}</button>
        </span></div>
      <p class="plan-form__end num" id="planEnd"></p>
      <label class="plan-form__row"><span class="plan-form__label">Programme</span>
        <select id="planProg" class="plan-form__select"><option value="">Aucun</option>${progs}</select></label>
      <label class="plan-form__col"><span class="plan-form__label">Note</span>
        <textarea id="planNote" class="coach-textarea" rows="3" maxlength="${PLAN_NOTE_MAX}" placeholder="Facultatif" aria-describedby="planNoteHint">${esc(f.note || '')}</textarea>
        <span class="plan-form__hint" id="planNoteHint">Visible par toi uniquement. N'y note pas de données de santé.</span></label>
      ${phase ? '<button type="button" class="plan-form__delete" id="planDelete">Supprimer la phase</button>' : ''}
    </div>`;
  const read = panel => ({
    id: f.id, goal: panel.querySelector('input[name="planGoal"]:checked')?.value || '',
    name: $('#planName', panel).value, start: $('#planStart', panel).value, weeks: Number($('#planWeeks', panel).dataset.weeks),
    progName: $('#planProg', panel).value || null, note: $('#planNote', panel).value,
  });
  // Titre court sur un écran étroit (iPhone SE) : il tient entre « Annuler » et « Enregistrer »
  const narrow = window.innerWidth < 380;
  const res = sheet({ title: phase ? (narrow ? 'Modifier' : 'Modifier la phase') : (narrow ? 'Phase' : 'Nouvelle phase'), confirm: 'Enregistrer', body,
    onConfirm: async panel => {
      const v = read(panel);
      if (!v.goal) { showToast('Choisis un objectif', { error: true }); return false; }
      if (planDayNum(v.start) === null) { flagInvalid($('#planStart', panel), 'Date invalide'); return false; }
      const other = planOverlap(phases, v);
      if (other) { showToast(`Chevauche « ${phaseTitle(other)} » (${phaseRangeText(other).toLowerCase()})`, { error: true }); return false; }
      const r = await coachPlanSave(uid, v);
      if (!r.ok) { if (r.kind !== 'busy') showToast(coachErrorText(r.kind), { error: true }); return false; }
      return { saved: v };
    } });
  // Champs vivants : fin de phase, durée, nom proposé
  const panel = [...document.querySelectorAll('.sheet-root .plan-form')].pop();
  if (panel) {
    const out = $('#planWeeks', panel), end = $('#planEnd', panel), name = $('#planName', panel);
    const refresh = () => {
      const w = Number(out.dataset.weeks), start = $('#planStart', panel).value;
      out.textContent = plural(w, 'semaine', 'semaines');
      $('#planWeeksDec', panel).disabled = w <= 1;
      $('#planWeeksInc', panel).disabled = w >= PLAN_MAX_WEEKS;
      end.textContent = planDayNum(start) === null ? '' : `Fin le ${fmtDate(planTs(planAddDays(start, w * 7 - 1)), 'day')}`;
    };
    const step = d => { out.dataset.weeks = String(Math.min(PLAN_MAX_WEEKS, Math.max(1, Number(out.dataset.weeks) + d))); haptic(); refresh(); };
    $('#planWeeksDec', panel).addEventListener('click', () => step(-1));
    $('#planWeeksInc', panel).addEventListener('click', () => step(1));
    $('#planStart', panel).addEventListener('input', refresh);
    panel.addEventListener('change', e => { if (e.target.name === 'planGoal') name.placeholder = planGoal(e.target.value).label; });
    $('#planDelete', panel)?.addEventListener('click', () => panel.closest('.sheet-root')?._close({ remove: true }));
    refresh();
  }
  const r = await res;
  if (r?.saved) showToast(phase ? 'Phase modifiée' : 'Phase ajoutée');
  if (r?.remove && phase) {
    if (!(await confirmSheet('Supprimer cette phase ?', `${phaseTitle(phase)}, ${phaseRangeText(phase).toLowerCase()}.`, 'Supprimer'))) return;
    const d = await coachPlanDelete(uid, phase.id);
    if (d.ok) showToast('Phase supprimée');
    else if (d.kind !== 'busy') showToast(coachErrorText(d.kind), { error: true });
  }
}

// ── Élève : ma phase ────────────────────────────────────────

// Groupe « Ta phase » de Mon coach (rien sans planning)
function studentPlanHtml() {
  const phases = planAvailable() ? myPlan() : null;
  if (!phases?.length) return '';
  const today = planToday(), cur = planCurrent(phases, today), next = planNext(phases, today);
  const shown = cur || next;
  if (!shown) return '';
  const after = cur && next ? `<p class="plan-next">Ensuite : ${esc(phaseTitle(next))}, à partir du ${esc(fmtDate(planTs(next.start), 'short'))} (${plural(next.weeks, 'semaine', 'semaines')})</p>` : '';
  return `
        <div class="group-title">${cur ? 'Ta phase' : 'Ta prochaine phase'}</div>
        ${planPhaseCardHtml(shown, { today })}
        ${after}`;
}
// Sous-titre discret de la cellule « Mon coach » : « Mini cut, semaine 3 sur 6 »
function studentPlanSub() {
  const phases = planAvailable() ? myPlan() : null;
  const cur = phases?.length ? planCurrent(phases) : null;
  return cur ? `${phaseTitle(cur)}, ${phaseStatusText(cur).toLowerCase()}` : '';
}

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'plan-overview': () => navigate('coach-planning'),
  'plan-open': (e, el) => navigate(makeRoute('coach-plan', el.dataset.uid)),
  'plan-add': (e, el) => planPhaseSheet(el.dataset.uid),
  'plan-edit': (e, el) => {
    const p = (planOfStudent(el.dataset.uid) || []).find(x => String(x.id) === el.dataset.id);
    if (p) planPhaseSheet(el.dataset.uid, p);
  },
});
