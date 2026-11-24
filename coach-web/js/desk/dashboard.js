// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : tableau de bord « Élèves » (docs/COACH_WEB.md, maquette 1-tableau-de-bord)
//
//  Liste réelle des élèves (deskStudentRows), ceux qui demandent une action en tête ; pastilles des 7 derniers jours
//  (séances, diète partagée) ; recherche (touche /) ; segments ; code d'invitation. J / K passent d'un élève à l'autre,
//  Entrée ouvre sa fiche (c'est un lien).
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_DIET_WORDS = { ok: 'suivie', part: 'partielle', off: 'pas suivie', none: 'rien de noté', today: 'en cours' };

function deskAvatar(name, cls = '') { return `<span class="av ${cls}" aria-hidden="true">${esc((name || '?').charAt(0).toUpperCase())}</span>`; }

function deskSesDotsHtml(r) {
  if (!r.sesDots) return `<span class="muted">${r.n7 ? plural(r.n7, 'séance', 'séances') : '—'}</span>`;
  const label = `Séances des 7 derniers jours : ${r.n7 ? plural(r.n7, 'séance', 'séances') : 'aucune'}`;
  return `<span class="ses" role="img" aria-label="${esc(label)}">${r.sesDots.map(d => `<i class="${d.n ? 'd' : ''}"></i>`).join('')}<b aria-hidden="true">${r.n7}</b></span>`;
}
function deskDietDotsHtml(r) {
  if (r.dietShared === null) return '<span class="faint">—</span>';
  if (!r.dietDots) return '<span class="muted">Non partagée</span>';
  const words = r.dietDots.map(d => `${DESK_WEEKDAYS[new Date(`${d.day}T12:00:00`).getDay()]} ${DESK_DIET_WORDS[d.status]}`).join(', ');
  const cls = { ok: 's', part: 'p', off: 'n', none: 'z', today: 'c' };
  return `<span class="dp" role="img" aria-label="${esc(`Diète des 7 derniers jours : ${words}`)}">${r.dietDots.map(d => `<i class="${cls[d.status]}"></i>`).join('')}</span>`;
}
function deskTodoHtml(r) {
  return r.todo.slice(0, DESK_TODO_SHOWN).map(t => {
    if (t.tone === 'badge') return `<span><span class="badge" aria-hidden="true">${t.n}</span><span class="sr">${t.n} </span> ${esc(t.text)}</span>`;
    if (t.tone === 'up') return `<span class="green">${deskIcon('trophy', 'xs gold')} ${esc(t.text)}</span>`;
    if (t.tone === 'dot') return `<span><span class="dot" aria-hidden="true"></span>${esc(t.text)}</span>`;
    return `<span class="${t.tone === 'warn' ? 'warn' : 'muted'}">${esc(t.text)}</span>`;
  }).join('');
}
function deskStudentRowHtml(r, now) {
  const sub = r.phase ? r.phase.text : '';
  const when = r.lastAt ? deskAgo(r.lastAt, now) : 'Pas encore de séance';
  return `<li><a class="row" href="#/eleve/${encodeURIComponent(r.id)}" data-student="${esc(r.id)}">
    <span class="who">${deskAvatar(r.name)}<span class="who-t"><b>${esc(r.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}<small class="when-n">${esc(when)}</small></span></span>
    <span class="c-ses">${deskSesDotsHtml(r)}</span>
    <span class="c-diet">${deskDietDotsHtml(r)}</span>
    <span class="todo">${deskTodoHtml(r)}</span>
    <span class="when"><span class="sr">Dernière séance : </span>${esc(when)}</span>
    <span class="chev">${deskIcon('chevron', 'sm')}</span>
  </a></li>`;
}
function deskListHtml(rows, now, label, { header = true } = {}) {
  if (!rows.length) return '';
  return `<div class="group lst">${header ? `<div class="row hdr" aria-hidden="true"><span>Élève</span><span>Séances (7 j)</span><span>Diète (7 j)</span><span>À faire</span><span class="r">Dernière séance</span><span></span></div>` : ''}
    <ul aria-label="${esc(label)}">${rows.map(r => deskStudentRowHtml(r, now)).join('')}</ul></div>`;
}

function deskInviteHtml(d) {
  if (!d.code) return `<div class="group"><div class="row"><div class="grow">Pas de code disponible</div><button type="button" class="btn tint" data-action="new-invite">Créer un code</button></div></div>`;
  const valid = d.codeExpires ? `Code valable jusqu'au ${fmtDate(d.codeExpires, 'short')}` : 'Ton code permanent : il ne change pas';
  return `<div class="group"><div class="row"><div class="grow"><span class="big tnum" id="invite-code">${esc(deskCodeText(d.code))}</span><div class="t2">${esc(valid)}</div></div>
    <button type="button" class="btn tint" data-action="copy-code" data-code="${esc(d.code)}">${deskIcon('copy', 'sm')}Copier</button></div></div>
    <div class="gfoot">Ton élève le saisit dans l'app : Réglages › Coach › Rejoindre ${esc(coachWord('un', d.form))}.${d.tier && d.tier.limit !== null ? ` ${esc(plural(d.tier.limit, 'élève offert', 'élèves offerts'))} par ton abonnement, ${esc(plural(d.tier.free, 'place libre', 'places libres'))}.` : ''}</div>`;
}

function deskDashboardHtml(d, ui) {
  const now = d.now, all = d.rows;
  const counts = deskFilterCounts(all);
  const filter = ui.filter in counts ? ui.filter : 'todo';
  const found = deskSearch(all, ui.query);
  const sum = deskTeamSummary(all);
  const plan = d.plans ? deskPlanningItems(all, now).slice(0, 4) : [];
  const date = fmtDate(now, 'day');
  const segs = DESK_FILTERS.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === filter}" class="${k === filter ? 'on' : ''}" data-action="filter" data-filter="${k}">${esc(l)}<em>${counts[k]}</em></button>`).join('');
  let list;
  if (ui.query.trim()) {
    list = found.length ? `<div class="gh">${esc(plural(found.length, 'élève trouvé', 'élèves trouvés'))}</div>${deskListHtml(found, now, 'Résultats de la recherche')}`
      : `<div class="empty">Aucun élève ne s'appelle « ${esc(ui.query.trim())} ».</div>`;
  } else if (!all.length) {
    list = `<div class="empty"><b>Pas encore d'élève.</b><br>Donne ton code d'invitation : tes élèves le saisissent dans l'app.</div>`;
  } else if (filter === 'todo') {
    const todo = all.filter(r => r.act), rest = all.filter(r => !r.act);
    list = (todo.length ? `<div class="gh">À traiter · triés par urgence</div>${deskListHtml(todo, now, 'Élèves à traiter')}` : '<div class="empty">Rien à traiter : tout le monde est à jour.</div>')
      + (rest.length ? `<div class="gh gap">Les autres</div>${deskListHtml(rest, now, 'Les autres élèves', { header: !todo.length })}` : '');
  } else {
    const rows = all.filter(r => deskRowIn(filter, r));
    list = rows.length ? deskListHtml(rows, now, DESK_FILTERS.find(x => x[0] === filter)[1]) : '<div class="empty">Aucun élève dans ce filtre.</div>';
  }
  const stats = `<div class="stats summary-inline" aria-label="Cette semaine">
    <div class="stat"><span class="l">${deskIcon('messages', 'xs')}Messages non lus</span><b>${sum.unread}</b></div>
    <div class="stat"><span class="l">${deskIcon('programmes', 'xs')}Séances en 7 jours</span><b>${sum.sessions}</b></div>
    <div class="stat"><span class="l">${deskIcon('trophy', 'xs')}Records en 7 jours</span><b>${sum.records}</b></div>
    <div class="stat"><span class="l">À relancer</span><b>${sum.warn}</b></div></div>`;
  const rail = `<div class="rail">
    <section class="gblock" aria-labelledby="h-week"><h2 class="gh" id="h-week">Cette semaine</h2><div class="group">
      <div class="row">${deskIcon('messages', 'sm')}<div class="grow">Messages non lus</div><div class="v">${sum.unread ? `<span class="badge">${sum.unread}</span>` : '0'}</div></div>
      <div class="row">${deskIcon('programmes', 'sm')}<div class="grow">Séances en 7 jours</div><div class="v num">${sum.sessions}</div></div>
      <div class="row"><span class="gold">${deskIcon('trophy', 'sm')}</span><div class="grow">Records battus</div><div class="v num">${sum.records}</div></div>
      <div class="row"><span class="warn">${deskIcon('students', 'sm')}</span><div class="grow">À relancer</div><div class="v num">${sum.warn}</div></div>
    </div></section>
    ${plan.length ? `<section class="gblock" aria-labelledby="h-plan"><h2 class="gh" id="h-plan">Planning</h2><div class="group">${plan.map(p => `<a class="row" href="#/eleve/${encodeURIComponent(p.id)}"><div class="grow">${esc(p.name)}<div class="t2">${esc(p.text)}</div></div><div class="v${p.when ? '' : ' warn'}">${p.when ? esc(fmtDate(p.when, 'short')) : 'À planifier'}</div></a>`).join('')}</div></section>` : ''}
    <section class="gblock" aria-labelledby="h-inv"><h2 class="gh" id="h-inv">Inviter un élève</h2>${deskInviteHtml(d)}</section>
  </div>`;
  return `<div class="head"><div class="grow"><h1 class="title">Élèves</h1><div class="sub">${esc(date.charAt(0).toUpperCase() + date.slice(1))} · ${esc(plural(all.length, 'élève', 'élèves'))} · semaine ${deskIsoWeek(now)}</div></div>
    <button type="button" class="btn" data-action="invite">${deskIcon('plus', 'sm')}Inviter un élève</button></div>
  <div class="head tools">
    <label class="search">${deskIcon('search', 'sm')}<span class="sr">Rechercher un élève</span><input type="search" id="q" placeholder="Rechercher par pseudo" value="${esc(ui.query)}" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-keyshortcuts="/"></label>
    <div class="seg" role="radiogroup" aria-label="Filtrer les élèves">${segs}</div>
  </div>
  ${stats}
  <div class="cols dash"><div class="list-col">${list}</div>${rail}</div>
  <dialog id="invite-dialog" aria-labelledby="inv-title"><h2 id="inv-title" class="dlg-t">Inviter un élève</h2>${deskInviteHtml(d)}<form method="dialog" class="dlg-f"><button class="btn">Fermer</button></form></dialog>`;
}
